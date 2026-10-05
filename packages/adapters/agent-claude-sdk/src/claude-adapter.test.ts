import type {
  CanUseTool,
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import { HERO_INSTRUCTIONS, SUBMIT_TOOL } from './claude-session';

type Script = (ctx: {
  options: Options;
  input: AsyncIterator<SDKUserMessage>;
  hook: (name: string, input: unknown) => Promise<void>;
}) => AsyncGenerator<SDKMessage>;

interface SubmitTool {
  name: string;
  handler: (args: {
    summary: string;
  }) => Promise<{ content: { text: string }[]; isError?: boolean }>;
}

/** A scripted stand-in for the SDK: query() records its call and plays back a script. */
function fakeSdk(script: Script) {
  const calls: { options: Options; inputs: SDKUserMessage[] }[] = [];
  const control = { interrupted: 0, closed: 0 };
  const tools: SubmitTool[] = [];
  const sdk: SdkModule = {
    query: ({ prompt, options = {} }) => {
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
        for (const m of matchers) {
          for (const h of m.hooks as HookCallback[]) {
            await h(hookInput as never, undefined, { signal: new AbortController().signal });
          }
        }
      };
      return Object.assign(script({ options, input, hook }), {
        interrupt: async () => {
          control.interrupted++;
          return undefined;
        },
        close: () => {
          control.closed++;
        },
      }) as unknown as Query;
    },
    createSdkMcpServer: ((config: { name: string; tools: SubmitTool[] }) => {
      tools.push(...config.tools);
      return { type: 'sdk', name: config.name };
    }) as unknown as SdkModule['createSdkMcpServer'],
    // biome-ignore lint/complexity/useMaxParams: mirrors the SDK's tool(name, description, schema, handler).
    tool: ((
      name: string,
      _description: string,
      _schema: unknown,
      handler: SubmitTool['handler'],
    ) => ({
      name,
      handler,
    })) as unknown as SdkModule['tool'],
  };
  return { sdk, calls, control, tools };
}

const sdkMessage = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const init = sdkMessage({ type: 'system', subtype: 'init', session_id: 'sess-1' });
const result = sdkMessage({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'ok',
  total_cost_usd: 0.01,
  modelUsage: {},
  queued_turn_count: 0,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const start = {
  heroId: 'h4',
  sessionId: 'sess-1',
  cwd: '/wt',
  classId: 'barbarian',
  prompt: 'Fix the login redirect',
};

function adapter(
  sdk: SdkModule,
  extra: {
    claudeCodePath?: string;
    platform?: NodeJS.Platform;
    hasCommand?: (name: string) => boolean;
  } = {},
) {
  return new ClaudeAdapter({
    env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
    claudeCodePath: () => extra.claudeCodePath ?? '  ',
    loadSdk: async () => sdk,
    platform: extra.platform ?? 'darwin',
    hasCommand: extra.hasCommand ?? (() => true),
  });
}

/** Holds the scripted query open until the test is done with it. */
function gate() {
  let open: () => void = () => {};
  const closed = new Promise<void>((r) => {
    open = r;
  });
  return { closed, open: () => open() };
}

describe('ClaudeAdapter sessions', () => {
  it('starts one streaming-input query with the hero options', async () => {
    const fake = fakeSdk(async function* ({ input }) {
      await input.next();
      yield init;
    });
    const events: AgentEvent[] = [];
    adapter(fake.sdk).startSession({ ...start, maxBudgetMicroUsd: 2_500_000 }, (e) =>
      events.push(e),
    );
    await flush();
    const { options, inputs } = fake.calls[0] ?? { options: {}, inputs: [] };
    expect(options).toMatchObject({
      cwd: '/wt',
      model: 'opus',
      sessionId: 'sess-1',
      env: { ANTHROPIC_API_KEY: 'sk-test' },
      systemPrompt: { type: 'preset', preset: 'claude_code', append: HERO_INSTRUCTIONS },
      permissionMode: 'acceptEdits',
      settingSources: ['project'],
      sandbox: { enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true },
      settings: { permissions: { ask: ['Bash(dangerouslyDisableSandbox:true)'] } },
      allowedTools: [SUBMIT_TOOL],
      maxBudgetUsd: 2.5,
    });
    expect(options.mcpServers).toHaveProperty('ibitsa');
    expect(options).not.toHaveProperty('resume');
    expect(options).not.toHaveProperty('pathToClaudeCodeExecutable');
    expect(inputs[0]).toMatchObject({
      message: { content: 'Fix the login redirect' },
      priority: 'next',
    });
    expect(events).toEqual([{ type: 'sessionStarted', sessionId: 'sess-1' }]);
  });

  it('resumes by session id, with or without a prompt, and falls back to Sonnet', async () => {
    const fake = fakeSdk(async function* () {
      yield* [];
    });
    adapter(fake.sdk).resumeSession(
      { heroId: 'h4', sessionId: 'sess-1', cwd: '/wt', classId: 'ranger', prompt: 'Continue.' },
      () => {},
    );
    adapter(fake.sdk).resumeSession(
      { heroId: 'h4', sessionId: 'sess-1', cwd: '/wt', classId: 'unknown' },
      () => {},
    );
    await flush();
    expect(fake.calls[0]?.options).toMatchObject({ resume: 'sess-1', model: 'sonnet' });
    expect(fake.calls[0]?.options).not.toHaveProperty('sessionId');
    expect(fake.calls[1]?.options.model).toBe('sonnet');
  });

  it('turns hooks and messages into events in order', async () => {
    const fake = fakeSdk(async function* ({ input, hook }) {
      await input.next();
      yield init;
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
    });
    const events: AgentEvent[] = [];
    adapter(fake.sdk).startSession(start, (e) => events.push(e));
    await flush();
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'sess-1' },
      { type: 'activityStarted', toolUseId: 'u1', kind: 'read', detail: 'a.ts' },
      { type: 'activityFinished', toolUseId: 'u1', outcome: 'ok' },
    ]);
  });

  it('passes a configured claude path', async () => {
    const fake = fakeSdk(async function* () {
      yield* [];
    });
    adapter(fake.sdk, { claudeCodePath: '/opt/claude' }).startSession(start, () => {});
    await flush();
    expect(fake.calls[0]?.options.pathToClaudeCodeExecutable).toBe('/opt/claude');
  });

  it('reports a failing SDK as an error event', async () => {
    const events: AgentEvent[] = [];
    new ClaudeAdapter({
      env: () => ({}),
      platform: 'darwin', // on Linux without bubblewrap the sandbox preflight would answer first
      loadSdk: async () => {
        throw new Error('Claude Code executable not found');
      },
    }).startSession(start, (e) => events.push(e));
    await flush();
    expect(events).toEqual([{ type: 'error', message: 'Claude Code executable not found' }]);
  });

  it('stops reporting once closed', async () => {
    const g = gate();
    const fake = fakeSdk(async function* () {
      await g.closed;
      yield init;
    });
    const events: AgentEvent[] = [];
    const session = adapter(fake.sdk).startSession(start, (e) => events.push(e));
    await flush();
    session.close();
    g.open();
    await flush();
    expect(events).toEqual([]);
    expect(fake.control.closed).toBe(1);
  });
});

describe('permissions and questions (#34)', () => {
  function withCanUseTool() {
    const g = gate();
    const fake = fakeSdk(async function* ({ input }) {
      await input.next();
      yield init;
      await g.closed;
    });
    const events: AgentEvent[] = [];
    const session = adapter(fake.sdk).startSession(start, (e) => events.push(e));
    const ask = async (...args: Parameters<CanUseTool>): Promise<PermissionResult | null> => {
      await flush();
      const canUseTool = fake.calls[0]?.options.canUseTool;
      if (!canUseTool) throw new Error('no canUseTool');
      return canUseTool(...args);
    };
    return { session, events, ask, done: g.open };
  }
  const opts = (toolUseID: string, extra: Record<string, unknown> = {}) => ({
    signal: new AbortController().signal,
    toolUseID,
    requestId: `req-${toolUseID}`,
    ...extra,
  });

  it('asks for a permission and allows it with the original input', async () => {
    const { session, events, ask, done } = withCanUseTool();
    const pending = ask(
      'Bash',
      { command: 'pnpm install' },
      opts('t1', { title: 'Run pnpm install?' }),
    );
    await flush();
    expect(events.at(-1)).toEqual({
      type: 'permission',
      requestId: 't1',
      tool: 'Bash',
      input: { command: 'pnpm install' },
      title: 'Run pnpm install?',
    });
    session.respondToPermission({ requestId: 't1', decision: 'allow' });
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { command: 'pnpm install' } });
    done();
  });

  it('denies with the note, or a default message', async () => {
    const { session, ask, done } = withCanUseTool();
    const first = ask('Bash', { command: 'rm -rf dist' }, opts('t1'));
    const second = ask('WebFetch', { url: 'https://x.dev' }, opts('t2'));
    await flush();
    session.respondToPermission({ requestId: 't1', decision: 'deny', note: 'Keep dist.' });
    session.respondToPermission({ requestId: 't2', decision: 'deny' });
    expect(await first).toEqual({ behavior: 'deny', message: 'Keep dist.' });
    expect(await second).toEqual({ behavior: 'deny', message: 'The user declined this.' });
    done();
  });

  it('answers an AskUserQuestion through updatedInput, joining multiple picks', async () => {
    const { session, events, ask, done } = withCanUseTool();
    const questions = [
      {
        question: 'Which checks?',
        header: 'Checks',
        options: [
          { label: 'lint', description: 'Biome' },
          { label: 'tests', description: 'Vitest', preview: 'pnpm test' },
        ],
        multiSelect: true,
      },
    ];
    const pending = ask('AskUserQuestion', { questions }, opts('q1'));
    await flush();
    expect(events.at(-1)).toEqual({ type: 'question', requestId: 'q1', questions });
    session.answerQuestion('q1', { 'Which checks?': ['lint', 'tests'] });
    expect(await pending).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which checks?': 'lint, tests' } },
    });
    done();
  });

  it('denies a request the SDK cancels, and ignores a late answer', async () => {
    const { session, ask, done } = withCanUseTool();
    const controller = new AbortController();
    const pending = ask(
      'Bash',
      { command: 'ls' },
      { signal: controller.signal, toolUseID: 't1', requestId: 'r1' },
    );
    await flush();
    controller.abort();
    expect(await pending).toEqual({ behavior: 'deny', message: 'The request was cancelled.' });
    session.respondToPermission({ requestId: 't1', decision: 'allow' }); // no-op
    done();
  });

  it('denies everything still waiting when the session closes', async () => {
    const { session, ask } = withCanUseTool();
    const pending = ask('Bash', { command: 'ls' }, opts('t1'));
    await flush();
    session.close();
    expect(await pending).toEqual({ behavior: 'deny', message: 'The session closed.' });
  });
});

describe('submit_task (#34)', () => {
  it('reports the submission and returns the verdict to the hero', async () => {
    const g = gate();
    const fake = fakeSdk(async function* ({ input, hook }) {
      await input.next();
      yield init;
      await hook('PreToolUse', {
        tool_name: SUBMIT_TOOL,
        tool_input: { summary: 'Fixed it' },
        tool_use_id: 'u9',
      });
      await g.closed;
    });
    const events: AgentEvent[] = [];
    const session = adapter(fake.sdk).startSession(start, (e) => events.push(e));
    await flush();
    const submit = fake.tools.find((t) => t.name === 'submit_task');
    if (!submit) throw new Error('no submit_task tool');

    const rejected = submit.handler({ summary: 'Fixed it' });
    await flush();
    expect(events.at(-1)).toEqual({ type: 'taskSubmitted', toolUseId: 'u9', summary: 'Fixed it' });
    session.completeSubmit({
      toolUseId: 'u9',
      accepted: false,
      reason: 'Commit your changes first.',
    });
    expect(await rejected).toEqual({
      content: [{ type: 'text', text: 'Not submitted: Commit your changes first.' }],
      isError: true,
    });

    await fake.calls[0]?.options.hooks?.PreToolUse?.[0]?.hooks[0]?.(
      { tool_name: SUBMIT_TOOL, tool_input: {}, tool_use_id: 'u10' } as never,
      undefined,
      { signal: new AbortController().signal },
    );
    const accepted = submit.handler({ summary: 'Fixed it, committed' });
    await flush();
    session.completeSubmit({ toolUseId: 'u10', accepted: true });
    expect(await accepted).toEqual({
      content: [{ type: 'text', text: 'Submitted. Your work will be reviewed.' }],
    });
    g.open();
  });
});

describe('messages and the full stop (#34)', () => {
  function working() {
    const g = gate();
    const fake = fakeSdk(async function* ({ input, hook }) {
      await input.next(); // the prompt
      yield init;
      await hook('PreToolUse', {
        tool_name: 'Bash',
        tool_input: { command: 'pnpm test' },
        tool_use_id: 'u1',
      });
      await g.closed;
      await hook('PostToolUse', {
        tool_name: 'Bash',
        tool_input: {},
        tool_response: {},
        tool_use_id: 'u1',
      });
      await input.next();
      yield result;
      await input.next();
    });
    const session = adapter(fake.sdk).startSession(start, () => {});
    return { fake, session, finishTool: g.open };
  }
  const sent = (fake: ReturnType<typeof fakeSdk>) =>
    (fake.calls[0]?.inputs ?? []).slice(1).map((m) => [m.message.content, m.priority, m.origin]);

  it("sends 'now' at once with a human origin", async () => {
    const { fake, session, finishTool } = working();
    await flush();
    session.send('look at auth.ts instead', 'now');
    finishTool(); // the scripted SDK reads its next input after the tool
    await flush();
    expect(sent(fake)[0]).toEqual(['look at auth.ts instead', 'now', { kind: 'human' }]);
  });

  it("holds 'next' until a tool finishes, then releases one at each safe point", async () => {
    const { fake, session, finishTool } = working();
    await flush();
    session.send('also update the docs', 'next');
    session.send('and the changelog', 'next');
    await flush();
    expect(sent(fake)).toEqual([]);
    finishTool();
    await flush();
    expect(sent(fake)).toEqual([
      ['also update the docs', 'next', undefined],
      ['and the changelog', 'next', undefined],
    ]);
  });

  it('drops held messages on stop and interrupts', async () => {
    const { fake, session, finishTool } = working();
    await flush();
    session.send('also update the docs', 'next');
    session.interrupt();
    finishTool();
    await flush();
    expect(sent(fake)).toEqual([]);
    expect(fake.control.interrupted).toBe(1);
  });

  it("sends 'next' at once when the hero is idle", async () => {
    const fake = fakeSdk(async function* ({ input }) {
      await input.next();
      yield init;
      yield result;
      await input.next();
    });
    const session = adapter(fake.sdk).startSession(start, () => {});
    await flush();
    session.send('one more thing', 'next');
    await flush();
    expect(sent(fake)).toEqual([['one more thing', 'next', undefined]]);
  });
});

describe('hero settings in sessions (#35)', () => {
  it('reports a missing sandbox dependency instead of starting', async () => {
    const fake = fakeSdk(async function* () {
      yield* [];
    });
    const events: AgentEvent[] = [];
    adapter(fake.sdk, { platform: 'linux', hasCommand: (name) => name !== 'socat' }).startSession(
      start,
      (e) => events.push(e),
    );
    await flush();
    expect(fake.calls).toEqual([]);
    expect(events).toEqual([{ type: 'error', message: expect.stringContaining('needs socat') }]);
  });

  it('allows test commands next to submit_task on native Windows, with no sandbox', async () => {
    const fake = fakeSdk(async function* () {
      yield* [];
    });
    adapter(fake.sdk, { platform: 'win32' }).startSession(start, () => {});
    await flush();
    const options = fake.calls[0]?.options;
    expect(options?.sandbox).toBeUndefined();
    expect(options?.allowedTools?.[0]).toBe(SUBMIT_TOOL);
    expect(options?.allowedTools).toContain('Bash(pnpm test *)');
  });

  it('loads the setting sources the user chose', async () => {
    const fake = fakeSdk(async function* () {
      yield* [];
    });
    new ClaudeAdapter({
      env: () => ({}),
      loadSdk: async () => fake.sdk,
      platform: 'darwin',
      settingSources: () => ['project', 'user'],
    }).startSession(start, () => {});
    await flush();
    expect(fake.calls[0]?.options.settingSources).toEqual(['project', 'user']);
  });
});
