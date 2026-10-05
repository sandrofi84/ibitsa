import type {
  HookCallback,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { QueryFunction } from './claude-adapter.types';

/** A scripted stand-in for the SDK's query(): records its call and plays back a script. */
function fakeQuery(
  script: (ctx: {
    options: Options;
    input: AsyncIterator<SDKUserMessage>;
    hook: (name: string, input: unknown) => Promise<void>;
  }) => AsyncGenerator<SDKMessage>,
) {
  const calls: { options: Options; inputs: SDKUserMessage[] }[] = [];
  const control = { interrupted: 0, closed: 0 };
  const query: QueryFunction = ({ prompt, options = {} }) => {
    const call = { options, inputs: [] as SDKUserMessage[] };
    calls.push(call);
    const iterator = (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
    const input: AsyncIterator<SDKUserMessage> = {
      next: async () => {
        const r = await iterator.next();
        if (!r.done) call.inputs.push(r.value);
        return r;
      },
    };
    const hook = async (name: string, hookInput: unknown) => {
      const matchers = options.hooks?.[name as keyof NonNullable<Options['hooks']>] ?? [];
      for (const m of matchers)
        for (const h of m.hooks as HookCallback[])
          await h(hookInput as never, undefined, { signal: new AbortController().signal });
    };
    const generator = script({ options, input, hook });
    return Object.assign(generator, {
      interrupt: async () => {
        control.interrupted++;
        return undefined;
      },
      close: () => {
        control.closed++;
      },
    }) as unknown as Query;
  };
  return { query, calls, control };
}

const sdk = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const flush = () => new Promise((r) => setTimeout(r, 0));
const start = {
  heroId: 'h4',
  sessionId: 'sess-1',
  cwd: '/wt',
  classId: 'barbarian',
  prompt: 'Fix the login redirect',
};

function adapter(
  query: QueryFunction,
  env: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-test' },
) {
  return new ClaudeAdapter({
    env: () => env,
    claudeCodePath: () => '  ',
    loadQuery: async () => query,
  });
}

describe('ClaudeAdapter', () => {
  it('starts one streaming-input query with the hero options', async () => {
    const fake = fakeQuery(async function* ({ input }) {
      await input.next();
      yield sdk({ type: 'system', subtype: 'init', session_id: 'sess-1' });
    });
    const events: AgentEvent[] = [];
    adapter(fake.query).startSession({ ...start, maxBudgetMicroUsd: 2_500_000 }, (e) =>
      events.push(e),
    );
    await flush();
    const { options, inputs } = fake.calls[0] ?? { options: {}, inputs: [] };
    expect(options).toMatchObject({
      cwd: '/wt',
      model: 'opus',
      sessionId: 'sess-1',
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      permissionMode: 'default',
      settingSources: ['project'],
      maxBudgetUsd: 2.5,
    });
    expect(options).not.toHaveProperty('resume');
    expect(options).not.toHaveProperty('pathToClaudeCodeExecutable'); // blank path = bundled binary
    expect(inputs[0]).toMatchObject({
      type: 'user',
      message: { role: 'user', content: 'Fix the login redirect' },
      priority: 'next',
    });
    expect(events).toEqual([{ type: 'sessionStarted', sessionId: 'sess-1' }]);
  });

  it('resumes by session id, with or without a prompt', async () => {
    const fake = fakeQuery(async function* () {
      yield* [];
    });
    adapter(fake.query).resumeSession(
      {
        heroId: 'h4',
        sessionId: 'sess-1',
        cwd: '/wt',
        classId: 'ranger',
        prompt: 'Continue with the task.',
      },
      () => {},
    );
    adapter(fake.query).resumeSession(
      { heroId: 'h4', sessionId: 'sess-1', cwd: '/wt', classId: 'unknown-class' },
      () => {},
    );
    await flush();
    expect(fake.calls[0]?.options).toMatchObject({ resume: 'sess-1', model: 'sonnet' });
    expect(fake.calls[0]?.options).not.toHaveProperty('sessionId');
    expect(fake.calls[1]?.options.model).toBe('sonnet');
  });

  it('turns hooks and messages into events in order, and feeds sent messages as input', async () => {
    const fake = fakeQuery(async function* ({ input, hook }) {
      await input.next();
      yield sdk({ type: 'system', subtype: 'init', session_id: 'sess-1' });
      await hook('PreToolUse', {
        tool_name: 'Read',
        tool_input: { file_path: '/wt/a.ts' },
        tool_use_id: 'u1',
      });
      await hook('PostToolUse', {
        tool_name: 'Read',
        tool_input: {},
        tool_response: {},
        tool_use_id: 'u1',
      });
      await input.next();
    });
    const events: AgentEvent[] = [];
    const session = adapter(fake.query).startSession(start, (e) => events.push(e));
    await flush();
    session.send('also update the docs', 'now');
    await flush();
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'sess-1' },
      { type: 'activityStarted', toolUseId: 'u1', kind: 'read', detail: 'a.ts' },
      { type: 'activityFinished', toolUseId: 'u1', outcome: 'ok' },
    ]);
    expect(fake.calls[0]?.inputs[1]).toMatchObject({
      message: { content: 'also update the docs' },
      priority: 'now',
    });
  });

  it('passes a configured claude path and interrupts the query', async () => {
    const fake = fakeQuery(async function* ({ input }) {
      await input.next();
      await input.next();
      yield* [];
    });
    const session = new ClaudeAdapter({
      env: () => ({}),
      claudeCodePath: () => '/opt/claude',
      loadQuery: async () => fake.query,
    }).startSession(start, () => {});
    await flush();
    session.interrupt();
    expect(fake.calls[0]?.options.pathToClaudeCodeExecutable).toBe('/opt/claude');
    expect(fake.control.interrupted).toBe(1);
  });

  it('reports a failing SDK as an error event', async () => {
    const events: AgentEvent[] = [];
    new ClaudeAdapter({
      env: () => ({}),
      loadQuery: async () => {
        throw new Error('Claude Code executable not found');
      },
    }).startSession(start, (e) => events.push(e));
    await flush();
    expect(events).toEqual([{ type: 'error', message: 'Claude Code executable not found' }]);
  });

  it('stops reporting once closed', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const fake = fakeQuery(async function* () {
      await gate;
      yield sdk({ type: 'system', subtype: 'init', session_id: 'sess-1' });
    });
    const events: AgentEvent[] = [];
    const session = adapter(fake.query).startSession(start, (e) => events.push(e));
    await flush();
    session.close();
    release();
    await flush();
    expect(events).toEqual([]);
    expect(fake.control.closed).toBe(1);
  });
});
