import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ReviewEvent, Verdict } from '@ibitsa/protocol';
import { REVIEW_INSTRUCTIONS, reviewBrief, type ReviewSession as Session } from '@ibitsa/runtime';
import { z } from 'zod';
import { loadSdk } from './claude-session';
import { CouncillorSkills } from './councillor-skills';
import { FINISH_MS } from './elder-session';
import type { ToolReply } from './elder-session.types';
import type { ReviewSessionInit } from './review-session.types';
import { callIdOf } from './round-table-session';

export const VERDICT_TOOL = 'mcp__ibitsa__submit_verdict';
/** A reviewer reads: the diff, and the files around it when it must. */
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** Enough to look around a diff; the cap usually ends it first. */
const MAX_TURNS = 20;

/** The reviewers' instructions (#201: shared with ACP reviewers), appended to the system prompt. */
export { REVIEW_INSTRUCTIONS };

const VERDICT_SHAPE = {
  verdict: z.enum(['pass', 'changes']),
  findings: z.array(
    z.object({
      severity: z.enum(['blocking', 'suggestion']),
      criterion: z
        .string()
        .optional()
        .describe('The acceptance criterion it fails, word for word.'),
      kind: z
        .enum(['bug', 'security', 'breaks'])
        .optional()
        .describe('Why it blocks when no criterion covers it.'),
      file: z.string().optional(),
      line: z.number().int().optional(),
      message: z.string().describe('What is wrong and what to fix.'),
      revisit: z
        .string()
        .optional()
        .describe('A decision id (D3) to reconsider; suggestions only.'),
    }),
  ),
};

/**
 * One councillor's review of one task (spec §5.5, #138): a short, read-only session on the review
 * effort's model and cap, briefed with the councillor's `## Review` guidance, the diff, its criteria,
 * the decisions the task keeps to and the check output. It files `submit_verdict`; core rules on it
 * (`checkVerdict`) and the verdict goes back as the tool's result. Ending without an accepted verdict
 * is an error core escalates.
 */
export class ReviewSession implements Session {
  private readonly init: ReviewSessionInit;
  private query: Query | null = null;
  private closed = false;
  private filed = false;
  private failed = false;
  private readonly verdicts = new Map<
    string,
    (verdict: { accepted: boolean; reason?: string }) => void
  >();

  constructor(init: ReviewSessionInit) {
    this.init = init;
    void this.run();
  }

  completeTool({
    toolUseId,
    accepted,
    reason,
  }: {
    toolUseId: string;
    accepted: boolean;
    reason?: string;
  }): void {
    // Marked now: the runtime closes the session in the same step, before the handler resumes.
    if (accepted && this.verdicts.has(toolUseId)) this.filed = true;
    const resolve = this.verdicts.get(toolUseId);
    this.verdicts.delete(toolUseId);
    resolve?.(reason === undefined ? { accepted } : { accepted, reason });
  }

  close(): void {
    this.closed = true;
    for (const resolve of this.verdicts.values())
      resolve({ accepted: false, reason: 'The review has ended.' });
    this.verdicts.clear();
    if (!this.filed) {
      this.query?.close();
      return;
    }
    // A filed review finishes its last turn first, so the result's cost still arrives.
    const query = this.query;
    setTimeout(() => query?.close(), FINISH_MS).unref?.();
  }

  /** The submit_verdict handler: core rules on the verdict; its answer is the tool's result. */
  private async submitVerdict(input: unknown, callId?: string): Promise<ToolReply> {
    const toolUseId = callId ?? `verdict-${Date.now()}`;
    const ruled = new Promise<{ accepted: boolean; reason?: string }>((resolve) =>
      this.verdicts.set(toolUseId, resolve),
    );
    this.emit({
      type: 'verdictSubmitted',
      toolUseId,
      verdict: JSON.parse(JSON.stringify(input)) as Verdict,
    });
    const { accepted, reason } = await ruled;
    if (accepted) {
      this.filed = true;
      return { content: [{ type: 'text', text: 'Verdict filed. Your review is done.' }] };
    }
    return {
      content: [{ type: 'text', text: `Not accepted: ${reason ?? 'no reason given'}` }],
      isError: true,
    };
  }

  private async run(): Promise<void> {
    try {
      const sdk = await (this.init.adapter.loadSdk ?? loadSdk)();
      const ibitsa = sdk.createSdkMcpServer({
        name: 'ibitsa',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'submit_verdict',
            'File your verdict on this task. Call it once, when your review is done.',
            VERDICT_SHAPE,
            (input, extra) => this.submitVerdict(input, callIdOf(extra)),
            { alwaysLoad: true },
          ),
        ],
      });
      const query = sdk.query({ prompt: this.prompt(), options: this.options(ibitsa) });
      this.query = query;
      if (this.closed) query.close();
      for await (const message of query) this.message(message);
      if (!this.filed && !this.closed && !this.failed) {
        this.emit({ type: 'error', message: 'The reviewer finished without a verdict.' });
      }
    } catch (error) {
      if (!this.closed)
        this.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  private options(ibitsa: NonNullable<Options['mcpServers']>[string]): Options {
    const { adapter, start } = this.init;
    const claudeCodePath = adapter.claudeCodePath?.()?.trim();
    return {
      cwd: start.cwd,
      model: start.model,
      env: adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: REVIEW_INSTRUCTIONS },
      settingSources: ['project'],
      tools: READ_TOOLS,
      mcpServers: { ibitsa },
      allowedTools: [...READ_TOOLS, VERDICT_TOOL],
      canUseTool: async () => ({ behavior: 'deny', message: 'A reviewer only reads the code.' }),
      maxTurns: MAX_TURNS,
      ...(start.maxBudgetMicroUsd === undefined
        ? {}
        : { maxBudgetUsd: start.maxBudgetMicroUsd / 1_000_000 }),
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
  }

  /** The first message: who reviews, with its skill's guidance, against what, and the work itself. */
  private prompt(): string {
    const { start, adapter } = this.init;
    const found = CouncillorSkills.of({ cwd: start.cwd, adapter }).review(start.councillorId);
    return reviewBrief({
      start,
      guidance: found ? { title: found.info.title, guidance: found.guidance } : null,
    });
  }

  private message(m: SDKMessage): void {
    if (m.type === 'system' && m.subtype === 'init') {
      this.emit({ type: 'sessionStarted', sessionId: m.session_id });
      return;
    }
    if (m.type !== 'result') return;
    this.emit({ type: 'usage', totalCost: Math.round(m.total_cost_usd * 1_000_000) });
    if (this.filed || this.closed) return;
    if (m.subtype === 'error_max_budget_usd') {
      this.emit({
        type: 'error',
        message:
          'The reviewer reached the spend cap you set (ibitsa.council.reviewBudgetUsd) before its verdict. Raise or clear it in the Guild Hall, then run it again.',
      });
    } else if (m.subtype === 'error_max_turns') {
      this.emit({ type: 'error', message: 'The reviewer took too many steps without a verdict.' });
    } else if (m.subtype !== 'success') {
      this.emit({
        type: 'error',
        message: `The review stopped: ${m.subtype.replaceAll('_', ' ')}.`,
      });
    }
  }

  private emit(event: ReviewEvent): void {
    if (event.type === 'error') {
      if (this.failed) return;
      this.failed = true;
    }
    this.init.onEvent(event);
  }
}
