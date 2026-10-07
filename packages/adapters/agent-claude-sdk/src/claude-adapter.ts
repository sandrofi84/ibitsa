import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname } from 'node:path';
import type { SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type {
  ActionInfo,
  AgentEvent,
  CouncilEvent,
  CouncillorInfo,
  ElderEvent,
  LessonsEvent,
  ReviewEvent,
} from '@ibitsa/protocol';
import type {
  AgentAdapter,
  AgentSession,
  CreateActionRequest,
  CreateActionResult,
  ElderStart,
  LessonsStart,
  ReviewSession as ReviewSessionPort,
  ReviewStart,
  SessionResume,
  SessionStart,
  SittingSession,
  SittingStart,
} from '@ibitsa/runtime';
import { CHAMBERS_INSTRUCTIONS, ChambersSession } from './chambers-session';
import type { ClaudeAdapterOptions } from './claude-adapter.types';
import { ClaudeSession, loadSdk, plugins } from './claude-session';
import { CouncillorSkills } from './councillor-skills';
import { ElderSession } from './elder-session';
import { LessonsSession } from './lessons-session';
import { ReviewSession } from './review-session';
import { ROUND_TABLE_INSTRUCTIONS, RoundTableSession } from './round-table-session';
import { expandSkill } from './skill-expansion';
import type { Expansion } from './skill-expansion.types';
import { SkillFiles } from './skill-files';
import { SkillWriter } from './skill-writer';

/** The native Claude Agent SDK adapter (spec §11.3, §11.4). */
export class ClaudeAdapter implements AgentAdapter {
  readonly capabilities = { budgetCap: true, costReported: true };
  private readonly options: ClaudeAdapterOptions;

  constructor(options: ClaudeAdapterOptions) {
    this.options = options;
  }

  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession {
    return new ClaudeSession({
      adapter: this.options,
      cwd: start.cwd,
      classId: start.classId,
      session: { sessionId: start.sessionId },
      prompt: start.prompt,
      ...(start.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetMicroUsd: start.maxBudgetMicroUsd }),
      allowRules: start.allowRules ?? [],
      onEvent,
    });
  }

  resumeSession(resume: SessionResume, onEvent: (event: AgentEvent) => void): AgentSession {
    return new ClaudeSession({
      adapter: this.options,
      cwd: resume.cwd,
      classId: resume.classId,
      session: { resume: resume.sessionId },
      ...(resume.prompt === undefined ? {} : { prompt: resume.prompt }),
      ...(resume.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetMicroUsd: resume.maxBudgetMicroUsd }),
      allowRules: resume.allowRules ?? [],
      onEvent,
    });
  }

  /**
   * The `/` menu's actions for a folder (#84): what Claude Code itself would run there, from a short
   * session that never sends a message (no model call, no tokens), without Claude Code's own commands.
   */
  async listActions({ cwd }: { cwd: string }): Promise<ActionInfo[]> {
    const sdk = await (this.options.loadSdk ?? loadSdk)();
    const pluginDirs = this.options.pluginDirs?.() ?? [];
    const claudeCodePath = this.options.claudeCodePath?.()?.trim();
    const query = sdk.query({
      prompt: idle(),
      options: {
        cwd,
        env: this.options.env(),
        settingSources: this.options.settingSources?.() ?? ['project'],
        ...plugins(pluginDirs),
        ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
      },
    });
    let commands: SlashCommand[];
    try {
      commands = await query.supportedCommands();
    } finally {
      query.close();
    }
    const files = new SkillFiles({ cwd, home: this.options.home ?? homedir(), pluginDirs });
    return commands.filter((c) => !c.builtin).map((c) => toAction({ command: c, files }));
  }

  /** An action's prompt as Claude Code would expand it, for the preview (#85). */
  async previewAction({
    cwd,
    name,
    args,
  }: {
    cwd: string;
    name: string;
    args: string;
  }): Promise<Expansion | null> {
    const pluginDirs = this.options.pluginDirs?.() ?? [];
    const file = new SkillFiles({ cwd, home: this.options.home ?? homedir(), pluginDirs }).find(
      name,
    );
    if (!file) return null;
    return expandSkill({
      body: file.body,
      fields: file.fields,
      args,
      variables: { CLAUDE_PROJECT_DIR: cwd, CLAUDE_SKILL_DIR: dirname(file.path) },
    });
  }

  /**
   * A short hash of the council's prompts (§4.10, #106): part of the council version, so tallies from
   * before and after a prompt change are told apart without anyone bumping a number.
   */
  get councilPromptVersion(): string {
    return createHash('sha256')
      .update([ROUND_TABLE_INSTRUCTIONS, CHAMBERS_INSTRUCTIONS].join('\n'))
      .digest('hex')
      .slice(0, 12);
  }

  /** A councillor's review of one task (§5.5, #138): read-only, capped, ending with `submit_verdict`. */
  startReview(start: ReviewStart, onEvent: (event: ReviewEvent) => void): ReviewSessionPort {
    return new ReviewSession({ adapter: this.options, start, onEvent });
  }

  /** The elder's lessons at a campaign's end (§4.9, #167): no tools but `submit_lessons`, capped. */
  startLessons(start: LessonsStart, onEvent: (event: LessonsEvent) => void): { close(): void } {
    return new LessonsSession({ adapter: this.options, start, onEvent });
  }

  /**
   * Compacts a council's lead session after Finish (§4.9, #167): resumes it with Claude Code's
   * `/compact` and waits for it to end, so the next campaign resumes a lighter context.
   */
  async compactCouncil({ cwd, sessionId }: { cwd: string; sessionId: string }): Promise<void> {
    const sdk = await (this.options.loadSdk ?? loadSdk)();
    const claudeCodePath = this.options.claudeCodePath?.()?.trim();
    const query = sdk.query({
      prompt: '/compact',
      options: {
        cwd,
        resume: sessionId,
        env: this.options.env(),
        settingSources: ['project'],
        tools: [],
        maxTurns: 1,
        ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
      },
    });
    for await (const message of query) if (message.type === 'result') break;
  }

  /** The elder's research (spec §4.1, #101): read-only, capped, ending with `submit_brief`. */
  startElder(start: ElderStart, onEvent: (event: ElderEvent) => void): { close(): void } {
    return new ElderSession({ adapter: this.options, start, onEvent });
  }

  /** A sitting's lead session (spec §4.3): a round table (#103) or separate chambers (#105). */
  startSitting(start: SittingStart, onEvent: (event: CouncilEvent) => void): SittingSession {
    const init = { adapter: this.options, start, onEvent };
    return start.mode === 'chambers' ? new ChambersSession(init) : new RoundTableSession(init);
  }

  /** The councillors a folder can seat (§4.7, #98), read from the skill files; no session needed. */
  async listCouncillors({ cwd }: { cwd: string }): Promise<CouncillorInfo[]> {
    return new CouncillorSkills({
      cwd,
      home: this.options.home ?? homedir(),
      pluginDirs: this.options.pluginDirs?.() ?? [],
    }).list();
  }

  /** Writes a new action as a skill (#86): in the user's home, or the workspace repo for the project. */
  async createAction(request: CreateActionRequest): Promise<CreateActionResult> {
    return new SkillWriter(request.roots).write({
      draft: request.draft,
      overwrite: request.overwrite,
    });
  }
}

/** A prompt that never sends anything: the session only answers control requests. */
async function* idle(): AsyncGenerator<SDKUserMessage> {
  await new Promise(() => {});
}

const TARGETS = new Set(['hero', 'council', 'any']);

/**
 * The SDK tags descriptions with their source, e.g. "… (project)" or "(ibitsa) …" (seen in M2
 * planning): Ibitsa shows the source as its own field instead.
 */
function toAction({ command, files }: { command: SlashCommand; files: SkillFiles }): ActionInfo {
  let description = command.description;
  let source: ActionInfo['source'] = 'other';
  const tag = description.match(/ \((project|user)\)$/);
  if (command.name.includes(':')) {
    source = 'plugin';
    description = description.replace(/^\([^)]*\) /, '');
  } else if (tag) {
    source = tag[1] as 'project' | 'user';
    description = description.slice(0, -tag[0].length);
  }
  const target = files.find(command.name)?.fields['ibitsa-target'] ?? 'any';
  return {
    name: command.name,
    description,
    argumentHint: command.argumentHint,
    aliases: command.aliases ?? [],
    source,
    target: (TARGETS.has(target) ? target : 'any') as ActionInfo['target'],
  };
}
