import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentEvent } from '@ibitsa/protocol';
import type { AgentSession } from '@ibitsa/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter';
import type { AcpAdapterOptions, AgentPrices } from './acp-adapter.types';
import { CANT_RESUME } from './acp-session';
import { HERO_TOOL_INSTRUCTIONS, SESSION_CLOSED, SUBMIT_NEEDS_SUMMARY } from './hero-tools';
import { ToolBridge } from './tool-bridge';
import type { ToolHost, ToolSet } from './tool-bridge.types';

const FAKE_AGENT = fileURLToPath(new URL('../test/fake-agent.mjs', import.meta.url));
const BRIDGE_SCRIPT = fileURLToPath(new URL('../test/mcp-bridge.mjs', import.meta.url));
const SUBMITTED_TEXT = 'Submitted. Your work will be reviewed.';
/** Starting a Node process can take seconds on a busy CI runner (Windows especially). */
const until = (check: () => void) => vi.waitFor(check, { timeout: 10_000, interval: 20 });
vi.setConfig({ testTimeout: 30_000 });
const dirs: string[] = [];
const sessions: AgentSession[] = [];

afterEach(() => {
  for (const s of sessions.splice(0)) s.close();
  // On Windows the folder stays busy until the killed agent has gone.
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** A hero on the fake agent, with the requests the agent received and the events it produced. */
function hero({
  env = {},
  prices,
  prompt = 'hi',
  model,
  resume,
  mcpServers,
  tools,
}: {
  env?: Record<string, string>;
  prices?: AgentPrices;
  /** Text, the fake agent's steps, or steps that need the worktree's path. */
  prompt?: string | unknown[] | ((cwd: string) => unknown[]) | null;
  model?: string;
  resume?: string;
  mcpServers?: AcpAdapterOptions['mcpServers'];
  tools?: AcpAdapterOptions['tools'];
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-acp-'));
  dirs.push(cwd);
  const log = join(cwd, 'requests.jsonl');
  const adapter = new AcpAdapter({
    agent: {
      command: process.execPath,
      args: [FAKE_AGENT],
      env: { ...env, FAKE_ACP_LOG: log },
      ...(prices ? { prices } : {}),
    },
    ...(mcpServers ? { mcpServers } : {}),
    ...(tools ? { tools } : {}),
  });
  const events: AgentEvent[] = [];
  const steps = typeof prompt === 'function' ? prompt(cwd) : prompt;
  const text =
    steps === null ? undefined : typeof steps === 'string' ? steps : JSON.stringify(steps);
  const onEvent = (event: AgentEvent) => events.push(event);
  const session =
    resume === undefined
      ? adapter.startSession(
          {
            heroId: 'h1',
            sessionId: 'chosen-by-runtime',
            cwd,
            classId: 'seer',
            ...(model ? { model } : {}),
            prompt: text ?? '',
          },
          onEvent,
        )
      : adapter.resumeSession(
          {
            heroId: 'h1',
            sessionId: resume,
            cwd,
            classId: 'seer',
            ...(text === undefined ? {} : { prompt: text }),
          },
          onEvent,
        );
  sessions.push(session);
  const requests = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> })
      : [];
  const settled = (count = 1) =>
    until(() =>
      expect(events.filter((e) => e.type === 'turnEnded' || e.type === 'error').length).toBe(count),
    );
  return { cwd, session, events, requests, settled, adapter };
}

const messages = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === 'message' ? [e.text] : []));

describe('AcpSession: starting (§11.5)', () => {
  it('starts the agent in the worktree, sends the prompt, and reports the turn', async () => {
    const { cwd, events, requests, settled } = hero();
    await settled();
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'fake-session-1' },
      { type: 'message', text: 'echo: hi' },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
    const [initialize, created] = requests();
    // Form questions, and no file system or terminal: the agent uses its own tools.
    expect(initialize?.params.clientCapabilities).toMatchObject({
      elicitation: { form: {} },
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    });
    expect(created).toMatchObject({ method: 'session/new', params: { cwd, mcpServers: [] } });
  });

  it('passes the other MCP servers it is given', async () => {
    const bridge = { name: 'ibitsa', command: 'bridge', args: [], env: [] };
    const { requests, settled } = hero({ mcpServers: () => [bridge] });
    await settled();
    expect(requests()[1]?.params.mcpServers).toEqual([bridge]);
  });

  it("sets the class's model through the agent's model option, when it offers it", async () => {
    const config = JSON.stringify([
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'fast',
        options: [
          {
            group: 'g',
            name: 'All',
            options: [
              { value: 'fast', name: 'Fast' },
              { value: 'deep', name: 'Deep' },
            ],
          },
        ],
      },
    ]);
    const chosen = hero({ env: { FAKE_ACP_CONFIG: config }, model: 'deep' });
    await chosen.settled();
    expect(chosen.requests()).toContainEqual({
      method: 'session/set_config_option',
      params: { sessionId: 'fake-session-1', configId: 'model', value: 'deep' },
    });
    // A model the agent doesn't offer leaves its default (the party check names it, #199).
    const unknown = hero({ env: { FAKE_ACP_CONFIG: config }, model: 'gpt-x' });
    await unknown.settled();
    expect(unknown.requests().map((r) => r.method)).not.toContain('session/set_config_option');
  });
});

describe('AcpSession: activity and messages', () => {
  it('turns tool calls into activities, with tests told apart from other commands', async () => {
    const { events, settled } = hero({
      prompt: (cwd) => [
        {
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm1',
            content: { type: 'text', text: 'Let me ' },
          },
        },
        {
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm1',
            content: { type: 'text', text: 'check.' },
          },
        },
        {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 't1',
            title: 'Run tests',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { command: ['pnpm', 'test'] },
          },
        },
        { update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'failed' } },
        {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 't2',
            title: 'Read a.ts',
            kind: 'read',
            status: 'pending',
            locations: [{ path: `${cwd}/src/a.ts` }],
          },
        },
        { update: { sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'completed' } },
        {
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm2',
            content: { type: 'text', text: 'Fixing.' },
          },
        },
        {
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'm3',
            content: { type: 'text', text: 'Done.' },
          },
        },
      ],
    });
    await settled();
    expect(events.slice(1)).toEqual([
      { type: 'message', text: 'Let me check.' },
      { type: 'activityStarted', toolUseId: 't1', kind: 'test', detail: 'pnpm test' },
      { type: 'activityFinished', toolUseId: 't1', outcome: 'failed' },
      { type: 'activityStarted', toolUseId: 't2', kind: 'read', detail: 'src/a.ts' },
      { type: 'activityFinished', toolUseId: 't2', outcome: 'ok' },
      { type: 'message', text: 'Fixing.' },
      { type: 'message', text: 'Done.' },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
  });
});

describe('AcpSession: messages while working (§11.5 fallbacks)', () => {
  it('holds next messages until the turn ends, then sends them one turn each', async () => {
    const { session, events, settled } = hero({ prompt: [{ sleep: 300 }] });
    await until(() => expect(events[0]?.type).toBe('sessionStarted'));
    session.send('one', 'next');
    session.send('two', 'next');
    await settled(3);
    expect(events.slice(1)).toEqual([
      { type: 'turnEnded', queuedTurns: 1 },
      { type: 'turnStarted' },
      { type: 'message', text: 'echo: one' },
      { type: 'turnEnded', queuedTurns: 1 },
      { type: 'turnStarted' },
      { type: 'message', text: 'echo: two' },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
  });

  it('sends a message at once when the hero is idle', async () => {
    const { session, events, settled } = hero();
    await settled();
    session.send('again', 'next');
    await settled(2);
    expect(messages(events)).toEqual(['echo: hi', 'echo: again']);
  });

  it('cancels the turn for a now message, then sends it', async () => {
    const { session, events, requests, settled } = hero({ prompt: [{ waitCancel: true }] });
    await until(() => expect(requests().map((r) => r.method)).toContain('session/prompt'));
    session.send('stop that', 'now');
    session.send('and this', 'now');
    await settled(2);
    expect(requests().map((r) => r.method)).toContain('session/cancel');
    expect(messages(events)).toEqual(['echo: stop that\n\nand this']);
  });

  it('a stop cancels the turn and drops what was held', async () => {
    const { session, events, requests, settled } = hero({
      prompt: [
        {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 't9',
            title: 'Long build',
            kind: 'execute',
            status: 'in_progress',
            rawInput: { cmd: 'make' },
          },
        },
        { waitCancel: true },
      ],
    });
    await until(() => expect(events.map((e) => e.type)).toContain('activityStarted'));
    session.send('later', 'next');
    session.interrupt();
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests().filter((r) => r.method === 'session/prompt')).toHaveLength(1);
    expect(events.slice(1)).toEqual([
      { type: 'activityStarted', toolUseId: 't9', kind: 'run', detail: 'make' },
      // A tool cut short by a stop didn't fail.
      { type: 'activityFinished', toolUseId: 't9', outcome: 'ok' },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
  });
});

describe('AcpSession: permissions and questions', () => {
  const ask = {
    permission: {
      toolCall: {
        toolCallId: 't1',
        title: 'Run npm install',
        kind: 'execute',
        rawInput: { command: 'npm install' },
      },
      options: [
        { optionId: 'once', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    },
  };

  it('asks "Needs you" and answers with the matching option', async () => {
    const { session, events, settled } = hero({ prompt: [ask, ask, ask] });
    await until(() => expect(events.filter((e) => e.type === 'permission')).toHaveLength(1));
    expect(events[1]).toEqual({
      type: 'permission',
      requestId: 't1:1',
      tool: 'Run npm install',
      input: { command: 'npm install' },
      title: 'Run npm install',
    });
    session.respondToPermission({ requestId: 't1:1', decision: 'allow' });
    await until(() => expect(events.filter((e) => e.type === 'permission')).toHaveLength(2));
    session.respondToPermission({ requestId: 't1:2', decision: 'allow', always: true });
    await until(() => expect(events.filter((e) => e.type === 'permission')).toHaveLength(3));
    session.respondToPermission({ requestId: 't1:3', decision: 'deny', note: 'Use pnpm.' });
    // The note reaches the agent as the next message.
    await settled(2);
    // The fake agent's three replies share one message.
    expect(messages(events)).toEqual([
      [
        'permission: {"outcome":"selected","optionId":"once"}',
        'permission: {"outcome":"selected","optionId":"always"}',
        'permission: {"outcome":"selected","optionId":"no"}',
      ].join(''),
      'echo: The user declined that: Use pnpm.',
    ]);
  });

  it('never widens a plain allow to always', async () => {
    const onlyAlways = {
      permission: {
        ...ask.permission,
        options: [{ optionId: 'always', name: 'Always', kind: 'allow_always' }],
      },
    };
    const { session, events, settled } = hero({ prompt: [onlyAlways] });
    await until(() => expect(events.map((e) => e.type)).toContain('permission'));
    session.respondToPermission({ requestId: 't1:1', decision: 'allow' });
    await settled();
    expect(messages(events)).toEqual(['permission: {"outcome":"cancelled"}']);
  });

  it('answers a waiting permission as cancelled when the hero is stopped', async () => {
    const { session, events, settled } = hero({ prompt: [ask] });
    await until(() => expect(events.map((e) => e.type)).toContain('permission'));
    session.interrupt();
    await settled();
    expect(messages(events)).toEqual(['permission: {"outcome":"cancelled"}']);
    // A late answer finds nothing waiting.
    session.respondToPermission({ requestId: 't1:1', decision: 'allow' });
  });

  it('asks a form with choices as a question, and sends back the chosen values', async () => {
    const { session, events, settled } = hero({
      prompt: [
        {
          elicit: {
            message: 'Which database?',
            requestedSchema: {
              type: 'object',
              properties: {
                db: {
                  type: 'string',
                  title: 'Database',
                  oneOf: [
                    { const: 'pg', title: 'Postgres', description: 'Server' },
                    { const: 'sqlite', title: 'SQLite' },
                  ],
                },
              },
            },
          },
        },
      ],
    });
    await until(() => expect(events.map((e) => e.type)).toContain('question'));
    expect(events[1]).toEqual({
      type: 'question',
      requestId: 'q1',
      questions: [
        {
          question: 'Which database?',
          header: 'Database',
          options: [
            { label: 'Postgres', description: 'Server' },
            { label: 'SQLite', description: '' },
          ],
          multiSelect: false,
        },
      ],
    });
    session.answerQuestion('q1', { 'Which database?': 'SQLite' });
    await settled();
    expect(messages(events)).toEqual(['elicit: {"action":"accept","content":{"db":"sqlite"}}']);
  });

  it('declines a form the game cannot ask, so the agent asks in words instead', async () => {
    const { events, settled } = hero({
      prompt: [
        {
          elicit: {
            message: 'Your name?',
            requestedSchema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      ],
    });
    await settled();
    expect(events.map((e) => e.type)).not.toContain('question');
    expect(messages(events)).toEqual(['elicit: {"action":"decline"}']);
  });

  it('cancels a waiting question when the hero is stopped', async () => {
    const { session, events, settled } = hero({
      prompt: [
        {
          elicit: {
            message: 'Go on?',
            requestedSchema: { type: 'object', properties: { go: { type: 'boolean' } } },
          },
        },
      ],
    });
    await until(() => expect(events.map((e) => e.type)).toContain('question'));
    session.interrupt();
    await settled();
    expect(messages(events)).toEqual(['elicit: {"action":"cancel"}']);
    session.answerQuestion('q1', { 'Go on?': 'Yes' });
  });
});

describe('AcpSession: HP and gold', () => {
  it('reports context and a USD cost exactly; another currency stays unknown', async () => {
    const { events, settled } = hero({
      prompt: [
        {
          update: {
            sessionUpdate: 'usage_update',
            used: 1_000,
            size: 200_000,
            cost: { amount: 0.25, currency: 'USD' },
          },
        },
        {
          update: {
            sessionUpdate: 'usage_update',
            used: 2_000,
            size: 200_000,
            cost: { amount: 1, currency: 'EUR' },
          },
        },
      ],
    });
    await settled();
    expect(events.filter((e) => e.type === 'usage')).toEqual([
      { type: 'usage', contextUsed: 1_000, contextMax: 200_000, totalCost: 250_000 },
      { type: 'usage', contextUsed: 2_000, contextMax: 200_000 },
    ]);
  });

  it("estimates gold from a turn's tokens and the agent's prices", async () => {
    const usage = { inputTokens: 1_000, outputTokens: 400, thoughtTokens: 100, totalTokens: 1_500 };
    const { session, events, settled } = hero({
      prompt: [{ stop: 'end_turn', usage }],
      prices: { inputPerMillion: 3, outputPerMillion: 15 },
    });
    await settled();
    session.send(JSON.stringify([{ stop: 'end_turn', usage }]), 'next');
    await settled(2);
    expect(events.filter((e) => e.type === 'usage')).toEqual([
      { type: 'usage', totalCost: 10_500, costBasis: 'tokens × the agent’s prices' },
      { type: 'usage', totalCost: 21_000, costBasis: 'tokens × the agent’s prices' },
    ]);
  });
});

describe('AcpSession: Rest', () => {
  it("can't rest when the agent lists no compact command", async () => {
    const { session, requests, settled } = hero();
    await settled();
    expect(session.canCompact).toBe(false);
    session.compact();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests().filter((r) => r.method === 'session/prompt')).toHaveLength(1);
  });

  it('rests through the agent’s own /compact when it lists one', async () => {
    const { session, events, settled } = hero({
      env: { FAKE_ACP_COMMANDS: JSON.stringify([{ name: 'compact', description: 'Compact' }]) },
    });
    await settled();
    await until(() => expect(session.canCompact).toBe(true));
    session.compact();
    await settled(2);
    expect(events.slice(-4)).toEqual([
      { type: 'turnStarted' },
      { type: 'resting' },
      { type: 'compacted', trigger: 'manual', preTokens: 0 },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
  });
});

describe('AcpSession: resuming after a restart', () => {
  it('resumes with session/resume when the agent supports it, and waits idle', async () => {
    const { events, requests, settled } = hero({
      env: { FAKE_ACP_CAPS: JSON.stringify({ sessionCapabilities: { resume: {} } }) },
      resume: 'old-1',
      prompt: null,
    });
    await settled();
    expect(requests()[1]).toMatchObject({
      method: 'session/resume',
      params: { sessionId: 'old-1' },
    });
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'old-1' },
      { type: 'turnEnded', queuedTurns: 0 },
    ]);
  });

  it('falls back to session/load, without replaying the old conversation', async () => {
    const { events, requests, settled } = hero({
      env: { FAKE_ACP_CAPS: JSON.stringify({ loadSession: true }) },
      resume: 'old-1',
      prompt: 'go on',
    });
    await settled();
    expect(requests()[1]?.method).toBe('session/load');
    expect(messages(events)).toEqual(['echo: go on']);
  });

  it("says so when the agent can't resume", async () => {
    const { events, settled } = hero({ resume: 'old-1' });
    await settled();
    expect(events).toEqual([{ type: 'error', message: CANT_RESUME }]);
  });
});

describe('AcpSession: errors and closing', () => {
  it('reports a needed sign-in as an error', async () => {
    const { events, settled } = hero({ env: { FAKE_ACP_AUTH: 'required' } });
    await settled();
    expect(events).toEqual([{ type: 'error', message: expect.stringMatching(/auth/i) }]);
  });

  it('reports a failed prompt, and turns that stop early, as errors', async () => {
    for (const [steps, message] of [
      [[{ fail: 'Model overloaded' }], 'Model overloaded'],
      [[{ stop: 'max_tokens' }], 'The agent reached its output limit and stopped.'],
      [[{ stop: 'refusal' }], 'The agent refused to continue.'],
    ] as const) {
      const { events, settled } = hero({ prompt: [...steps] });
      await settled();
      expect(events.at(-1)).toEqual({ type: 'error', message });
    }
  });

  it('reports an agent that exits, with what it last wrote to stderr', async () => {
    const { events, settled } = hero({ prompt: [{ exit: 3 }] });
    await settled();
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: expect.stringContaining('exited with code 3'),
    });
  });

  it("reports an agent that can't start", async () => {
    const events: AgentEvent[] = [];
    const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-acp-'));
    dirs.push(cwd);
    const session = new AcpAdapter({ agent: { command: join(cwd, 'no-such-agent') } }).startSession(
      { heroId: 'h1', sessionId: 's', cwd, classId: 'seer', prompt: 'hi' },
      (e) => events.push(e),
    );
    sessions.push(session);
    await until(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      type: 'error',
      message: expect.stringContaining("Couldn't start the agent"),
    });
  });

  it('closes the session with the agent when it can, and goes quiet', async () => {
    const { session, events, requests, settled } = hero({
      env: { FAKE_ACP_CAPS: JSON.stringify({ sessionCapabilities: { close: {} } }) },
    });
    await settled();
    session.close();
    session.close();
    session.send('anyone?', 'next');
    await until(() => expect(requests().map((r) => r.method)).toContain('session/close'));
    expect(events.map((e) => e.type)).toEqual(['sessionStarted', 'message', 'turnEnded']);
  });

  it('ignores a submit result nobody is waiting for', async () => {
    const { session, settled } = hero();
    await settled();
    expect(() => session.completeSubmit({ toolUseId: 't', accepted: true })).not.toThrow();
  });
});

describe('AcpSession: submit_task through the tool bridge (#197)', () => {
  const bridges: ToolBridge[] = [];
  afterEach(() => {
    for (const b of bridges.splice(0)) b.close();
  });
  const bridge = () => {
    const b = new ToolBridge({ script: BRIDGE_SCRIPT, node: { command: process.execPath } });
    bridges.push(b);
    return b;
  };
  /** A tool host that hands the session's tool set to the test instead of an agent. */
  const stub = () => {
    let set: ToolSet | null = null;
    let closed = 0;
    const host: ToolHost = {
      open: async (tools) => {
        set = tools;
        return {
          server: { name: 'ibitsa', command: 'bridge', args: [], env: [] },
          close: () => {
            closed++;
          },
        };
      },
    };
    return { host, tools: () => set, closed: () => closed };
  };
  const mcpReply = (events: AgentEvent[]) =>
    messages(events).find((m) => m.startsWith('mcp: ')) ?? '';

  it('lists the bridge first, tells a new hero how to submit, and offers submit_task', async () => {
    const { requests, events, settled, session } = hero({
      tools: bridge(),
      mcpServers: () => [{ name: 'other', command: 'x', args: [], env: [] }],
      prompt: [{ mcp: { tool: 'submit_task', arguments: { summary: 'Fixed the redirect.' } } }],
    });
    await until(() => expect(events.map((e) => e.type)).toContain('taskSubmitted'));
    const submitted = events.find((e) => e.type === 'taskSubmitted');
    expect(submitted).toEqual({
      type: 'taskSubmitted',
      toolUseId: expect.stringMatching(/^submit-/),
      summary: 'Fixed the redirect.',
    });
    session.completeSubmit({
      toolUseId: submitted?.type === 'taskSubmitted' ? submitted.toolUseId : '',
      accepted: true,
    });
    await settled();
    expect(JSON.parse(mcpReply(events).slice(5))).toEqual({
      tools: ['submit_task'],
      result: { content: [{ type: 'text', text: SUBMITTED_TEXT }], isError: false },
    });
    const created = requests().find((r) => r.method === 'session/new');
    const servers = created?.params.mcpServers as { name: string; env: { name: string }[] }[];
    expect(servers.map((s) => s.name)).toEqual(['ibitsa', 'other']);
    expect(servers[0]?.env.map((e) => e.name)).toEqual(
      expect.arrayContaining(['IBITSA_BRIDGE', 'IBITSA_BRIDGE_TOKEN']),
    );
    const prompt = requests().find((r) => r.method === 'session/prompt')?.params.prompt;
    expect(prompt).toEqual([
      { type: 'text', text: HERO_TOOL_INSTRUCTIONS },
      { type: 'text', text: expect.stringContaining('submit_task') },
    ]);
  });

  it('returns a rejected submission with its reason, for the hero to fix', async () => {
    const { events, settled, session } = hero({
      tools: bridge(),
      prompt: [{ mcp: { tool: 'submit_task', arguments: { summary: 'Done.' } } }],
    });
    await until(() => expect(events.map((e) => e.type)).toContain('taskSubmitted'));
    const submitted = events.find((e) => e.type === 'taskSubmitted');
    session.completeSubmit({
      toolUseId: submitted?.type === 'taskSubmitted' ? submitted.toolUseId : '',
      accepted: false,
      reason: 'the tests fail.',
    });
    await settled();
    expect(JSON.parse(mcpReply(events).slice(5)).result).toEqual({
      content: [{ type: 'text', text: 'Not submitted: the tests fail.' }],
      isError: true,
    });
  });

  it('sends a resumed hero no instructions: it already had them', async () => {
    const tools = stub();
    const { requests, settled } = hero({
      tools: tools.host,
      resume: 'old',
      prompt: 'carry on',
      env: { FAKE_ACP_CAPS: JSON.stringify({ sessionCapabilities: { resume: {} } }) },
    });
    await settled();
    const prompt = requests().find((r) => r.method === 'session/prompt')?.params.prompt;
    expect(prompt).toEqual([{ type: 'text', text: 'carry on' }]);
    expect(requests().find((r) => r.method === 'session/resume')?.params.mcpServers).toEqual([
      { name: 'ibitsa', command: 'bridge', args: [], env: [] },
    ]);
  });

  it('turns away calls it can’t submit, and answers waiting ones when the session closes', async () => {
    const tools = stub();
    const { session, events, settled } = hero({ tools: tools.host });
    await settled();
    const set = tools.tools();
    expect(set?.tools.map((t) => t.name)).toEqual(['submit_task']);
    expect(await set?.call({ name: 'dispute_finding', arguments: {} })).toEqual({
      text: 'Unknown tool: dispute_finding',
      isError: true,
    });
    expect(await set?.call({ name: 'submit_task', arguments: { summary: '  ' } })).toEqual({
      text: SUBMIT_NEEDS_SUMMARY,
      isError: true,
    });
    const waiting = set?.call({ name: 'submit_task', arguments: { summary: 'Done.' } });
    await until(() => expect(events.map((e) => e.type)).toContain('taskSubmitted'));
    session.close();
    expect(await waiting).toEqual({ text: SESSION_CLOSED, isError: true });
    expect(tools.closed()).toBe(1);
    expect(await set?.call({ name: 'submit_task', arguments: { summary: 'Again.' } })).toEqual({
      text: SESSION_CLOSED,
      isError: true,
    });
  });

  it('gives the tools back when the session closes before they open', async () => {
    let closed = 0;
    let asked = false;
    let open: () => void = () => {};
    const host: ToolHost = {
      open: () =>
        new Promise((resolve) => {
          asked = true;
          open = () =>
            resolve({
              server: { name: 'ibitsa', command: 'bridge', args: [], env: [] },
              close: () => {
                closed++;
              },
            });
        }),
    };
    const { session, requests } = hero({ tools: host });
    // The session asks for its tools once the agent has answered `initialize`, which a slow runner
    // (Windows) may not have done yet when the agent logs the request.
    await until(() => expect(asked).toBe(true));
    session.close();
    open();
    await until(() => expect(closed).toBe(1));
    expect(requests().map((r) => r.method)).not.toContain('session/new');
  });
});
