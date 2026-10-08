import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import type { TestDetector } from '@ibitsa/runtime';
import { classify } from './activity';
import type { Worktree } from './worktree';

/**
 * Claude Agent SDK output → normalized `AgentEvent`s (spec §5.4, §7.3, §11.4; verified against
 * @anthropic-ai/claude-agent-sdk 0.3.289). Pure apart from the little state the mapping needs.
 */
export class EventMapper {
  /** A session starts by working on its prompt. */
  private inTurn = true;
  /** From the latest result's `modelUsage[*].contextWindow`; HP stays unknown until the first one. */
  private contextMax: number | undefined;
  private contextUsed: number | undefined;
  /** Set by a stop: the SDK ends an interrupted turn with an error result, which is no error here. */
  private stopping = false;
  private readonly worktree: Worktree;
  private readonly tests: TestDetector;

  constructor({ worktree, tests }: { worktree: Worktree; tests: TestDetector }) {
    this.worktree = worktree;
    this.tests = tests;
  }

  /** The user stopped the hero; the turn's result, whatever its subtype, just ends the turn. */
  interrupted(): void {
    if (this.inTurn) this.stopping = true;
  }

  message(m: SDKMessage): AgentEvent[] {
    switch (m.type) {
      case 'system':
        return this.system(m);
      case 'assistant': {
        // Subagent text and usage belong to the subagent's own context, not the hero's.
        if (m.parent_tool_use_id !== null) return [];
        const events: AgentEvent[] = [];
        if (!this.inTurn) {
          this.inTurn = true;
          events.push({ type: 'turnStarted' });
        }
        const text = m.message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim();
        if (text) events.push({ type: 'message', text });
        const u = m.message.usage;
        // The context actually sent on this request: exact as of the last request (spec §7.3).
        this.contextUsed =
          u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
        if (this.contextMax !== undefined) {
          events.push({
            type: 'usage',
            contextUsed: this.contextUsed,
            contextMax: this.contextMax,
          });
        }
        return events;
      }
      case 'result': {
        this.inTurn = false;
        const windows = Object.values(m.modelUsage).map((usage) => usage.contextWindow);
        if (windows.length > 0) this.contextMax = Math.max(...windows);
        const events: AgentEvent[] = [
          {
            type: 'usage',
            // Running total for the session, converted once to integer micro-dollars.
            totalCost: Math.round(m.total_cost_usd * 1_000_000),
            ...(this.contextUsed !== undefined && this.contextMax !== undefined
              ? { contextUsed: this.contextUsed, contextMax: this.contextMax }
              : {}),
          },
        ];
        const stopped = this.stopping;
        this.stopping = false;
        if (m.subtype === 'error_max_budget_usd') events.push({ type: 'budgetExhausted' });
        else if (stopped || (m.subtype === 'success' && !m.is_error)) {
          events.push({ type: 'turnEnded', queuedTurns: m.queued_turn_count ?? 0 });
        } else {
          const detail = m.subtype === 'success' ? m.result : m.subtype.replaceAll('_', ' ');
          events.push({ type: 'error', message: detail || 'The session ended with an error.' });
        }
        return events;
      }
      default:
        return [];
    }
  }

  preToolUse(input: PreToolUseHookInput): AgentEvent[] {
    return [
      {
        type: 'activityStarted',
        toolUseId: input.tool_use_id,
        ...classify({
          tool: input.tool_name,
          input: input.tool_input,
          worktree: this.worktree,
          tests: this.tests,
        }),
      },
    ];
  }

  postToolUse(input: PostToolUseHookInput): AgentEvent[] {
    return [
      {
        type: 'activityFinished',
        toolUseId: input.tool_use_id,
        outcome: reportsFailure(input.tool_response) ? 'failed' : 'ok',
      },
    ];
  }

  /** A tool the user interrupted didn't fail; anything else did. */
  postToolUseFailure(input: PostToolUseFailureHookInput): AgentEvent[] {
    return [
      {
        type: 'activityFinished',
        toolUseId: input.tool_use_id,
        outcome: input.is_interrupt ? 'ok' : 'failed',
      },
    ];
  }

  private system(m: Extract<SDKMessage, { type: 'system' }>): AgentEvent[] {
    switch (m.subtype) {
      case 'init':
        this.inTurn = true;
        return [{ type: 'sessionStarted', sessionId: m.session_id }];
      case 'status':
        if (m.status === 'compacting') return [{ type: 'resting' }];
        // A failed compaction ends the rest without freeing context.
        if (m.compact_result === 'failed') {
          return [{ type: 'compacted', trigger: 'manual', preTokens: this.contextUsed ?? 0 }];
        }
        return [];
      case 'compact_boundary': {
        const meta = m.compact_metadata;
        if (meta.post_tokens !== undefined) this.contextUsed = meta.post_tokens;
        return [
          {
            type: 'compacted',
            trigger: meta.trigger,
            preTokens: meta.pre_tokens,
            ...(meta.post_tokens === undefined ? {} : { postTokens: meta.post_tokens }),
          },
        ];
      }
      case 'api_retry':
        return [{ type: 'retrying', reason: `${m.error}, retry ${m.attempt} of ${m.max_retries}` }];
      default:
        return [];
    }
  }
}

/** Some tools report failure inside a successful result (e.g. a non-zero exit). */
function reportsFailure(response: unknown): boolean {
  if (typeof response !== 'object' || response === null) return false;
  const r = response as Record<string, unknown>;
  if (r.is_error === true) return true;
  for (const key of ['exitCode', 'exit_code', 'returnCode']) {
    if (typeof r[key] === 'number' && r[key] !== 0) return true;
  }
  return false;
}
