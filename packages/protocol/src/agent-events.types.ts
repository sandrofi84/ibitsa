import type { ActivityKind, AskUserQuestion } from './snapshot.types';
import type { MicroUsd } from './values.types';

/**
 * Normalized adapter output for one session (spec §11.3, with the #2 and #10 corrections).
 * Core input only: never sent to a front end.
 */
export type AgentEvent =
  /** The session is alive (Claude SDK: `system`/`init`); ends traveling. */
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'turnStarted' }
  /** `queuedTurns` > 0 means another turn follows at once. */
  | { type: 'turnEnded'; queuedTurns: number }
  /** A tool started (Claude SDK: `PreToolUse`), including tools run by the hero's own subagents. */
  | { type: 'activityStarted'; toolUseId: string; kind: ActivityKind; detail?: string }
  /** `failed` = `PostToolUseFailure` or a tool result with `is_error`. */
  | { type: 'activityFinished'; toolUseId: string; outcome: 'ok' | 'failed' }
  | { type: 'message'; text: string }
  /** Answered with `answerQuestion` on the session. */
  | { type: 'question'; requestId: string; questions: AskUserQuestion[] }
  /** Answered with `respondToPermission`. `title`/`description` are the agent's own prompt text, if any. */
  | {
      type: 'permission';
      requestId: string;
      tool: string;
      input: unknown;
      title?: string;
      description?: string;
      /**
       * Rules the agent suggests for "Always allow" (#62), e.g. `Bash(npm run lint:*)`. Absent or empty
       * when not offered: never for writing outside the worktree or escaping the sandbox.
       */
      alwaysAllow?: string[];
      /**
       * "Always allow" only for this quest, never the project (#200): an ACP agent's own rule, which
       * means nothing to other agents' sessions.
       */
      alwaysQuestOnly?: boolean;
      /**
       * Set when the request crosses a hard limit (spec §11.6), or when no sandbox of Ibitsa's keeps
       * the hard limits for this hero (`unsandboxed`, #200): auto mode never answers these (#63).
       */
      boundary?: 'sandboxEscape' | 'outsideWorktree' | 'unsandboxed';
    }
  /**
   * Running totals for the session, never deltas. Omitted fields are unknown, not zero. `costBasis`
   * marks `totalCost` as estimated rather than reported, saying how (e.g. "tokens × agent prices").
   */
  | {
      type: 'usage';
      contextUsed?: number;
      contextMax?: number;
      totalCost?: MicroUsd;
      costBasis?: string;
    }
  /** Compaction started (Claude SDK: `status: 'compacting'`). */
  | { type: 'resting' }
  | { type: 'compacted'; trigger: 'manual' | 'auto'; preTokens: number; postTokens?: number }
  /** The hero called `submit_task`; core runs the submit check before accepting it (§5.5). */
  | { type: 'taskSubmitted'; toolUseId: string; summary: string }
  /** The hero says two findings contradict each other or a recorded decision (`dispute_finding`, #136). */
  | { type: 'findingDisputed'; reviewIds: string[]; reason: string }
  /** The adapter's native budget cap stopped the turn (Claude SDK: `error_max_budget_usd`). */
  | { type: 'budgetExhausted' }
  /** A retryable API error; the session keeps its state. */
  | { type: 'retrying'; reason: string }
  /** The session cannot continue. A failing tool is not an error. */
  | { type: 'error'; message: string };
