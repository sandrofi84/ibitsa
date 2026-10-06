import type {
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
  PreToolUseHookInput,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { TestDetector } from './activity';
import { EventMapper } from './event-mapper';
import { Worktree } from './worktree';

// Minimal SDK messages, shaped by @anthropic-ai/claude-agent-sdk 0.3.289's sdk.d.ts.
const sdk = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const init = sdk({ type: 'system', subtype: 'init', session_id: 's1' });
const assistant = (
  text: string,
  {
    tokens = { input: 1_000, read: 20_000, create: 500 },
    parent = null,
  }: { tokens?: { input: number; read: number; create: number }; parent?: string | null } = {},
) =>
  sdk({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: {
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text },
      ],
      usage: {
        input_tokens: tokens.input,
        cache_read_input_tokens: tokens.read,
        cache_creation_input_tokens: tokens.create,
      },
    },
  });
const result = (fields: Record<string, unknown> = {}) =>
  sdk({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    total_cost_usd: 0.0421,
    modelUsage: {
      'claude-sonnet-5-5': { contextWindow: 1_000_000 },
      'claude-haiku-4-5': { contextWindow: 200_000 },
    },
    queued_turn_count: 0,
    ...fields,
  });
const mapper = () =>
  new EventMapper({ worktree: new Worktree({ dir: '/wt' }), tests: new TestDetector('/nowhere') });

describe('EventMapper.message', () => {
  it('starts the session on init', () => {
    expect(mapper().message(init)).toEqual([{ type: 'sessionStarted', sessionId: 's1' }]);
  });

  it('reports text and, once the context window is known, exact context usage', () => {
    const m = mapper();
    expect(m.message(assistant('Looking at auth.ts'))).toEqual([
      { type: 'message', text: 'Looking at auth.ts' },
    ]);
    expect(m.message(result())).toEqual([
      { type: 'usage', totalCost: 42_100, contextUsed: 21_500, contextMax: 1_000_000 },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
    expect(
      m.message(assistant('Next step', { tokens: { input: 2_000, read: 30_000, create: 0 } })),
    ).toEqual([
      { type: 'turnStarted' },
      { type: 'message', text: 'Next step' },
      { type: 'usage', contextUsed: 32_000, contextMax: 1_000_000 },
    ]);
  });

  it("ignores a subagent's text and usage", () => {
    expect(mapper().message(assistant('sub', { parent: 'toolu_parent' }))).toEqual([]);
  });

  it('passes queued turns through', () => {
    expect(
      mapper()
        .message(result({ queued_turn_count: 2 }))
        .at(-1),
    ).toEqual({ type: 'turnEnded', queuedTurns: 2 });
  });

  it('reports a budget stop as budgetExhausted, not an error', () => {
    expect(
      mapper()
        .message(result({ subtype: 'error_max_budget_usd', is_error: true }))
        .at(-1),
    ).toEqual({
      type: 'budgetExhausted',
    });
  });

  it('ends a stopped turn quietly, though the SDK reports it as an error (#40)', () => {
    const m = mapper();
    m.interrupted();
    expect(m.message(result({ subtype: 'error_during_execution', is_error: true })).at(-1)).toEqual(
      { type: 'turnEnded', queuedTurns: 0 },
    );
    // Only that one result: a later failure is an error again.
    m.message(assistant('again'));
    expect(m.message(result({ subtype: 'error_during_execution', is_error: true })).at(-1)).toEqual(
      { type: 'error', message: 'error during execution' },
    );
  });

  it('ignores a stop while waiting for orders', () => {
    const m = mapper();
    m.message(result());
    m.interrupted();
    m.message(assistant('hi'));
    expect(m.message(result({ subtype: 'error_during_execution', is_error: true })).at(-1)).toEqual(
      { type: 'error', message: 'error during execution' },
    );
  });

  it('reports execution failures and failed results as errors', () => {
    expect(
      mapper()
        .message(result({ subtype: 'error_during_execution', is_error: true }))
        .at(-1),
    ).toEqual({
      type: 'error',
      message: 'error during execution',
    });
    expect(
      mapper()
        .message(result({ is_error: true, result: 'Invalid API key' }))
        .at(-1),
    ).toEqual({
      type: 'error',
      message: 'Invalid API key',
    });
  });

  it('maps compaction to resting and compacted', () => {
    const m = mapper();
    expect(m.message(sdk({ type: 'system', subtype: 'status', status: 'compacting' }))).toEqual([
      { type: 'resting' },
    ]);
    expect(
      m.message(
        sdk({
          type: 'system',
          subtype: 'compact_boundary',
          compact_metadata: { trigger: 'auto', pre_tokens: 180_000, post_tokens: 40_000 },
        }),
      ),
    ).toEqual([{ type: 'compacted', trigger: 'auto', preTokens: 180_000, postTokens: 40_000 }]);
    expect(
      m.message(sdk({ type: 'system', subtype: 'status', status: null, compact_result: 'failed' })),
    ).toEqual([{ type: 'compacted', trigger: 'manual', preTokens: 40_000 }]);
    expect(
      m.message(
        sdk({ type: 'system', subtype: 'status', status: null, compact_result: 'success' }),
      ),
    ).toEqual([]);
  });

  it('reports API retries', () => {
    expect(
      mapper().message(
        sdk({
          type: 'system',
          subtype: 'api_retry',
          error: 'overloaded',
          attempt: 2,
          max_retries: 10,
        }),
      ),
    ).toEqual([{ type: 'retrying', reason: 'overloaded, retry 2 of 10' }]);
  });

  it('ignores messages it has no use for', () => {
    expect(mapper().message(sdk({ type: 'system', subtype: 'hook_started' }))).toEqual([]);
    expect(mapper().message(sdk({ type: 'user', message: {} }))).toEqual([]);
  });
});

describe('EventMapper hooks', () => {
  const pre = (tool: string, input: unknown) =>
    ({
      hook_event_name: 'PreToolUse',
      tool_name: tool,
      tool_input: input,
      tool_use_id: 'u1',
    }) as PreToolUseHookInput;
  const post = (response: unknown) =>
    ({
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: {},
      tool_response: response,
      tool_use_id: 'u1',
    }) as PostToolUseHookInput;
  const failure = (isInterrupt?: boolean) =>
    ({
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: {},
      tool_use_id: 'u1',
      error: 'x',
      is_interrupt: isInterrupt,
    }) as PostToolUseFailureHookInput;

  it('starts an activity with its kind and detail', () => {
    expect(mapper().preToolUse(pre('Bash', { command: 'pnpm test' }))).toEqual([
      { type: 'activityStarted', toolUseId: 'u1', kind: 'test', detail: 'pnpm test' },
    ]);
  });

  it('finishes ok, or failed when the tool reports an error or a non-zero exit', () => {
    expect(mapper().postToolUse(post({ stdout: 'ok' }))).toEqual([
      { type: 'activityFinished', toolUseId: 'u1', outcome: 'ok' },
    ]);
    for (const response of [{ is_error: true }, { exitCode: 1 }, { exit_code: 2 }]) {
      expect(mapper().postToolUse(post(response))[0]).toMatchObject({ outcome: 'failed' });
    }
  });

  it('counts a tool failure as failed, but not one the user interrupted', () => {
    expect(mapper().postToolUseFailure(failure())[0]).toMatchObject({ outcome: 'failed' });
    expect(mapper().postToolUseFailure(failure(true))[0]).toMatchObject({ outcome: 'ok' });
  });
});
