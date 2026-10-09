import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { checkBrief, type ElderEvent } from '@ibitsa/protocol';
import { z } from 'zod';
import { loadSdk } from './claude-session';
import type { ElderSessionInit, ToolReply } from './elder-session.types';

export const BRIEF_TOOL = 'mcp__ibitsa__submit_brief';

/** The only built-in tools the elder has: it reads, never writes or runs anything (spec §4.1). */
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** Enough to look around a repository; the cap usually ends it first. */
const MAX_TURNS = 40;

/** Appended to Claude Code's system prompt; the same for every research session, so it caches (spec §10). */
export const ELDER_INSTRUCTIONS = `You are the elder of Ibitsa's council. Before anyone plans or writes code, you research a task in this repository and write a short research brief. You only read: never edit files or run commands.

Research briefly: find the files and areas the task touches, the project's conventions (its CLAUDE.md, AGENTS.md, ADRs), and the risks. Don't read whole directories; follow what the task needs.

Then call submit_brief once:
- task: the task in your own words, one or two sentences.
- files: the relevant files and areas, a path and one line each (add a line range when it helps).
- findings: patterns, conventions, risks and unknowns every councillor should know. Short lines.
- councillors: who should sit on the council, from the list you're given, each with a one-line reason. Leave out those with nothing to add.
- slices: for each recommended councillor, what in this task touches its field, as pointers (path, line range, note), not file contents.
- effort: light, standard or deep for a round table, with a reason. councillorEfforts: the same for each recommended councillor.
- quickQuest: whether the task is small and clear enough for one hero without a council, and why.
- relatedCampaigns: when you're shown past campaigns, the ones whose records bear on this task, each with why. Judge from the index; read a record only when it looks related. Leave it empty when none do.
- keptContext: only when you're told the council's context was kept from an earlier campaign: whether this task is related to that work, and why. Otherwise leave it out.

If submit_brief rejects the brief, fix what it says and call it again.`;

/** The tool's input as the model sees it; the brief is then checked against Ibitsa's own schema. */
const pointer = z.object({
  path: z.string(),
  lines: z.string().optional().describe('A line or range, e.g. "40-120".'),
  note: z.string().describe('Why it matters, in one line.'),
});
const effort = z.enum(['light', 'standard', 'deep']);
const reason = z.string();
const BRIEF_SHAPE = {
  task: z.string().describe('The task in your own words.'),
  files: z.array(pointer),
  findings: z.array(z.string()),
  slices: z.array(
    z.object({ councillorId: z.string(), summary: z.string(), pointers: z.array(pointer) }),
  ),
  councillors: z.array(z.object({ councillorId: z.string(), reason })),
  effort: z.object({ level: effort, reason }),
  councillorEfforts: z.array(z.object({ councillorId: z.string(), level: effort, reason })),
  quickQuest: z.object({ recommended: z.boolean(), reason }),
  relatedCampaigns: z
    .array(z.object({ campaignId: z.string(), title: z.string(), why: z.string() }))
    .optional(),
  keptContext: z.object({ related: z.boolean(), reason }).optional(),
};

/** How long a session with its result filed may take to finish its last turn and report its cost. */
export const FINISH_MS = 60_000;

/**
 * The elder's research (spec §4.1, #101): a short, read-only session on a cheap model with a cap. It
 * ends when the elder files a brief that passes the schema and names only councillors who exist; the
 * runtime then closes it. Ending any other way is an error the user sees.
 */
export class ElderSession {
  private readonly init: ElderSessionInit;
  private query: Query | null = null;
  private closed = false;
  private briefed = false;
  /** An error was reported: the end of the stream adds nothing. */
  private failed = false;

  constructor(init: ElderSessionInit) {
    this.init = init;
    void this.run();
  }

  /**
   * Stops the elder. After an accepted brief it finishes its last turn first, so the result's cost
   * still arrives (#138); a minute at most.
   */
  close(): void {
    this.closed = true;
    if (!this.briefed) {
      this.query?.close();
      return;
    }
    const query = this.query;
    setTimeout(() => query?.close(), FINISH_MS).unref?.();
  }

  /** The submit_brief handler: problems go back to the elder to fix; a good brief goes to core. */
  submitBrief(input: unknown): ToolReply {
    const checked = checkBrief({
      input,
      councillors: this.init.start.councillors.map((c) => c.id),
      campaigns: this.init.start.pastRecords.map((r) => r.campaignId),
    });
    if (!checked.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `The brief wasn't accepted:\n${checked.problems.map((p) => `- ${p}`).join('\n')}\nFix these and call submit_brief again.`,
          },
        ],
        isError: true,
      };
    }
    this.briefed = true;
    this.emit({ type: 'briefSubmitted', brief: checked.brief });
    return { content: [{ type: 'text', text: 'Brief received. Your research is done.' }] };
  }

  private async run(): Promise<void> {
    try {
      const sdk = await (this.init.adapter.loadSdk ?? loadSdk)();
      const ibitsa = sdk.createSdkMcpServer({
        name: 'ibitsa',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'submit_brief',
            'File your research brief. Call it once, when your research is done.',
            BRIEF_SHAPE,
            async (input) => this.submitBrief(input),
            { alwaysLoad: true },
          ),
        ],
      });
      const query = sdk.query({ prompt: elderPrompt(this.init), options: this.options(ibitsa) });
      this.query = query;
      if (this.closed) query.close();
      for await (const message of query) this.message(message);
      if (!this.briefed && !this.closed && !this.failed) {
        this.emit({ type: 'error', message: 'The elder finished without writing a brief.' });
      }
    } catch (error) {
      if (!this.closed) {
        this.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private options(ibitsa: NonNullable<Options['mcpServers']>[string]): Options {
    const { adapter, start } = this.init;
    const claudeCodePath = adapter.claudeCodePath?.()?.trim();
    return {
      cwd: start.cwd,
      model: start.model,
      env: adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ELDER_INSTRUCTIONS },
      // The project's CLAUDE.md and rules tell the elder its conventions.
      settingSources: ['project'],
      tools: READ_TOOLS,
      mcpServers: { ibitsa },
      allowedTools: [...READ_TOOLS, BRIEF_TOOL],
      canUseTool: async () => ({ behavior: 'deny', message: 'The elder only reads the code.' }),
      maxTurns: MAX_TURNS,
      ...(start.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetUsd: start.maxBudgetMicroUsd / 1_000_000 }),
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
  }

  private message(m: SDKMessage): void {
    if (m.type === 'system' && m.subtype === 'init') {
      this.emit({ type: 'sessionStarted', sessionId: m.session_id });
      return;
    }
    if (m.type === 'assistant' && m.parent_tool_use_id === null) {
      for (const block of m.message.content) {
        if (block.type === 'tool_use') {
          this.emit({ type: 'activity', text: describe({ name: block.name, input: block.input }) });
        }
      }
      return;
    }
    if (m.type === 'result') {
      this.emit({ type: 'usage', totalCost: Math.round(m.total_cost_usd * 1_000_000) });
      if (this.briefed || this.closed) return;
      if (m.subtype === 'error_max_budget_usd') {
        this.emit({
          type: 'error',
          message:
            'The elder reached the spend cap you set (ibitsa.elder.budgetUsd) before finishing the brief. Raise or clear it in the Guild Hall, then ask again.',
        });
      } else if (m.subtype === 'error_max_turns') {
        this.emit({
          type: 'error',
          message: 'The elder took too many steps without finishing the brief.',
        });
      } else if (m.subtype !== 'success') {
        this.emit({
          type: 'error',
          message: `The research stopped: ${m.subtype.replaceAll('_', ' ')}.`,
        });
      }
    }
  }

  private emit(event: ElderEvent): void {
    if (event.type === 'error') this.failed = true;
    this.init.onEvent(event);
  }
}

/** The first message: the task and the councillors the elder may recommend. */
function elderPrompt({ start }: ElderSessionInit): string {
  const roster =
    start.councillors.length > 0
      ? start.councillors.map((c) => `- ${c.id} (${c.title}): ${c.description}`).join('\n')
      : '(none: recommend no councillors, and say whether a quick quest fits)';
  const past = start.pastRecords.map(
    (r) =>
      `- ${r.campaignId} · ${r.date} · ${r.title} (${r.status})${r.summary ? `: ${r.summary}` : ''} — ${r.path}`,
  );
  return [
    `Research this task and file a brief.\n\nTask:\n${start.task}\n\nCouncillors you may recommend:\n${roster}`,
    ...(past.length > 0
      ? [`Past campaigns (their records, newest first):\n${past.join('\n')}`]
      : []),
    ...(start.keptCouncil
      ? [
          `The council's context was kept from the campaign "${start.keptCouncil.from}". Say in keptContext whether this task is related to that work.`,
        ]
      : []),
  ].join('\n\n');
}

/** A tool call as a progress line, e.g. "Reading src/auth.ts". */
function describe({ name, input }: { name: string; input: unknown }): string {
  const field = (key: string) => {
    const value = (input as Record<string, unknown> | null)?.[key];
    return typeof value === 'string' ? value : '';
  };
  switch (name) {
    case 'Read':
      return `Reading ${field('file_path')}`;
    case 'Grep':
      return `Searching for ${field('pattern')}`;
    case 'Glob':
      return `Looking for ${field('pattern')}`;
    case BRIEF_TOOL:
      return 'Writing the brief';
    default:
      return `Using ${name}`;
  }
}
