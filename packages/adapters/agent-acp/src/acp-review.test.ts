import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReviewEvent, Verdict } from '@ibitsa/protocol';
import { REVIEW_INSTRUCTIONS, type ReviewSession, type ReviewStart } from '@ibitsa/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AcpAdapter } from './acp-adapter';
import type { AcpAdapterOptions, SpawnRequest } from './acp-adapter.types';
import {
  FINISH_MS,
  NO_BRIDGE,
  NO_VERDICT,
  OUT_OF_GOLD,
  REVIEW_STEPS,
  TOO_MANY_STEPS,
} from './acp-review';
import { spawnAgent } from './agent-connection';
import { VERDICT_TOOL_NOTE } from './review-tools';
import { ToolBridge } from './tool-bridge';
import type { ToolHost, ToolResult, ToolSet } from './tool-bridge.types';

const FAKE_AGENT = fileURLToPath(new URL('../test/fake-agent.mjs', import.meta.url));
const BRIDGE_SCRIPT = fileURLToPath(new URL('../test/mcp-bridge.mjs', import.meta.url));
/** Starting a Node process can take seconds on a busy CI runner (Windows especially). */
const until = (check: () => void) => vi.waitFor(check, { timeout: 10_000, interval: 20 });
vi.setConfig({ testTimeout: 30_000 });
const dirs: string[] = [];
const reviews: ReviewSession[] = [];
const bridges: ToolBridge[] = [];

afterEach(async () => {
  for (const r of reviews.splice(0)) r.close();
  for (const b of bridges.splice(0)) b.close();
  // On Windows the folder stays busy until the agent has gone, and a filed review lets its agent
  // finish the turn for up to FINISH_MS first. Retried without blocking, so that timer can fire.
  await Promise.all(
    dirs.splice(0).map((d) =>
      rm(d, {
        recursive: true,
        force: true,
        maxRetries: Math.ceil((FINISH_MS + 3_000) / 100),
        retryDelay: 100,
      }),
    ),
  );
}, FINISH_MS + 10_000);

const PASS: Verdict = { verdict: 'pass', findings: [] };
const CHANGES: Verdict = {
  verdict: 'changes',
  findings: [
    {
      severity: 'blocking',
      criterion: 'Logged-out users land on /login',
      file: 'src/auth.ts',
      line: 12,
      message: 'The redirect still goes to /home.',
    },
    { severity: 'suggestion', message: 'Name the constant.', revisit: 'D2' },
  ],
};

/** A tool host that hands the review's tool set to the test instead of an agent's MCP client. */
function stubHost() {
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
}

function brief(overrides: Partial<ReviewStart> = {}): Omit<ReviewStart, 'cwd'> {
  return {
    councillorId: 'tester',
    model: '',
    maxBudgetMicroUsd: 100_000,
    round: 1,
    diff: 'diff --git a/src/auth.ts b/src/auth.ts',
    task: { title: 'Fix the login redirect', description: 'Send logged-out users to /login.' },
    criteria: ['Logged-out users land on /login'],
    decisions: [],
    checks: [{ command: 'pnpm test', ok: true, output: '' }],
    guidance: { title: 'Tester', guidance: 'Check the tests cover the change.' },
    ...overrides,
  };
}

/** A review on the fake agent, running `script` for its brief. */
function review({
  script = [],
  env = {},
  tools,
  start = {},
  spawn,
}: {
  script?: unknown[];
  env?: Record<string, string>;
  tools?: ToolHost | null;
  start?: Partial<ReviewStart>;
  spawn?: AcpAdapterOptions['spawn'];
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-acp-review-'));
  dirs.push(cwd);
  const log = join(cwd, 'requests.jsonl');
  const adapter = new AcpAdapter({
    agent: {
      command: process.execPath,
      args: [FAKE_AGENT],
      env: { ...env, FAKE_ACP_LOG: log, FAKE_ACP_SCRIPT: JSON.stringify(script) },
    },
    ...(tools === null ? {} : { tools: tools ?? stubHost().host }),
    ...(spawn ? { spawn } : {}),
  });
  const events: ReviewEvent[] = [];
  const session = adapter.startReview({ cwd, ...brief(start) }, (event) => events.push(event));
  reviews.push(session);
  const requests = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as { method: string; params: Record<string, unknown> })
      : [];
  const said = () =>
    requests().flatMap((r) => (r.method === 'said' ? [String(r.params.text)] : []));
  return { cwd, session, events, requests, said };
}

const types = (events: ReviewEvent[]) => events.map((e) => e.type);
const submitted = (events: ReviewEvent[]) =>
  events.flatMap((e) => (e.type === 'verdictSubmitted' ? [e] : []));

describe('AcpReview: briefing (§5.5, #201)', () => {
  it('opens with the reviewers’ instructions, then the brief with the councillor’s guidance', async () => {
    const { requests, events } = review();
    await until(() => expect(types(events)).toContain('error'));
    const prompt = requests().find((r) => r.method === 'session/prompt')?.params.prompt as {
      text: string;
    }[];
    expect(prompt[0]?.text).toBe(`${REVIEW_INSTRUCTIONS}\n\n${VERDICT_TOOL_NOTE}`);
    expect(prompt[1]?.text).toContain('You are tester (Tester), reviewing round 1 of this task.');
    expect(prompt[1]?.text).toContain('Check the tests cover the change.');
    expect(prompt[1]?.text).toContain('- Logged-out users land on /login');
    expect(prompt[1]?.text).toContain('diff --git a/src/auth.ts');
    expect(events[0]).toEqual({ type: 'sessionStarted', sessionId: 'fake-session-1' });
  });

  it('says so when no skill gave guidance', async () => {
    const { requests, events } = review({ start: { guidance: null } });
    await until(() => expect(types(events)).toContain('error'));
    const prompt = requests().find((r) => r.method === 'session/prompt')?.params.prompt as {
      text: string;
    }[];
    expect(prompt[1]?.text).toContain(
      '(No skill file found: review from your name and the criteria.)',
    );
  });

  it('switches the agent to its read-only mode when it has one', async () => {
    const { requests, events } = review({
      env: {
        FAKE_ACP_MODES: JSON.stringify({
          currentModeId: 'agent',
          availableModes: [
            { id: 'agent', name: 'Agent' },
            { id: 'read-only', name: 'Read Only' },
          ],
        }),
      },
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(requests().find((r) => r.method === 'session/set_mode')?.params).toEqual({
      sessionId: 'fake-session-1',
      modeId: 'read-only',
    });
  });

  it('leaves an agent without one, or already in it, as it is', async () => {
    const none = review({
      env: {
        FAKE_ACP_MODES: JSON.stringify({
          currentModeId: 'agent',
          availableModes: [{ id: 'agent', name: 'Agent' }],
        }),
      },
    });
    const already = review({
      env: {
        FAKE_ACP_MODES: JSON.stringify({
          currentModeId: 'read-only',
          availableModes: [{ id: 'read-only', name: 'Read only' }],
        }),
      },
    });
    await until(() => expect(types(none.events)).toContain('error'));
    await until(() => expect(types(already.events)).toContain('error'));
    for (const r of [none, already])
      expect(r.requests().map((x) => x.method)).not.toContain('session/set_mode');
  });

  it('runs on the councillor’s own model when the agent offers it', async () => {
    const { requests, events } = review({
      start: { model: 'gpt-6-luna' },
      env: {
        FAKE_ACP_CONFIG: JSON.stringify([
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'gpt-6.1-sol',
            options: [
              { value: 'gpt-6.1-sol', name: 'Sol' },
              { value: 'gpt-6-luna', name: 'Luna' },
            ],
          },
        ]),
      },
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(requests().find((r) => r.method === 'session/set_config_option')?.params).toEqual({
      sessionId: 'fake-session-1',
      configId: 'model',
      value: 'gpt-6-luna',
    });
  });
});

describe('AcpReview: the verdict (§5.5, #201)', () => {
  it.each([
    ['a pass', PASS],
    ['changes with findings', CHANGES],
  ])('hands core %s as filed, and the ruling back as the tool’s result', async (_name, verdict) => {
    const host = stubHost();
    const { events, session } = review({ tools: host.host, script: [{ waitCancel: true }] });
    await until(() => expect(host.tools()).not.toBeNull());
    const reply = host.tools()?.call({ name: 'submit_verdict', arguments: verdict });
    await until(() => expect(submitted(events)).toHaveLength(1));
    const [filed] = submitted(events);
    expect(filed).toEqual({
      type: 'verdictSubmitted',
      toolUseId: expect.stringMatching(/^verdict-/),
      verdict,
    });
    session.completeTool({ toolUseId: filed?.toolUseId ?? '', accepted: true });
    await expect(reply).resolves.toEqual({ text: 'Verdict filed. Your review is done.' });
  });

  it('offers only submit_verdict, and refuses any other tool', async () => {
    const host = stubHost();
    review({ tools: host.host, script: [{ waitCancel: true }] });
    await until(() => expect(host.tools()).not.toBeNull());
    expect(host.tools()?.tools.map((t) => t.name)).toEqual(['submit_verdict']);
    await expect(host.tools()?.call({ name: 'submit_task', arguments: {} })).resolves.toEqual({
      text: 'Unknown tool: submit_task',
      isError: true,
    });
  });

  it('returns a rejected verdict with core’s reason, for the reviewer to fix and file again', async () => {
    const host = stubHost();
    const { events, session } = review({ tools: host.host, script: [{ waitCancel: true }] });
    await until(() => expect(host.tools()).not.toBeNull());
    const first = host.tools()?.call({ name: 'submit_verdict', arguments: { verdict: 'changes' } });
    await until(() => expect(submitted(events)).toHaveLength(1));
    session.completeTool({
      toolUseId: submitted(events)[0]?.toolUseId ?? '',
      accepted: false,
      reason: 'The verdict has problems:\n- findings is missing',
    });
    await expect(first).resolves.toEqual({
      text: 'Not accepted: The verdict has problems:\n- findings is missing',
      isError: true,
    });
    const second = host.tools()?.call({ name: 'submit_verdict', arguments: PASS });
    await until(() => expect(submitted(events)).toHaveLength(2));
    expect(submitted(events)[1]?.toolUseId).not.toBe(submitted(events)[0]?.toolUseId);
    session.completeTool({ toolUseId: submitted(events)[1]?.toolUseId ?? '', accepted: true });
    await expect(second).resolves.toEqual({ text: 'Verdict filed. Your review is done.' });
    expect(types(events)).not.toContain('error');
  });

  it('files through the real bridge: the agent’s MCP client sees the tool and core’s ruling', async () => {
    const bridge = new ToolBridge({ script: BRIDGE_SCRIPT, node: { command: process.execPath } });
    bridges.push(bridge);
    const { events, session, said } = review({
      tools: bridge,
      script: [{ mcp: { tool: 'submit_verdict', arguments: CHANGES } }],
    });
    await until(() => expect(submitted(events)).toHaveLength(1));
    expect(submitted(events)[0]?.verdict).toEqual(CHANGES);
    session.completeTool({ toolUseId: submitted(events)[0]?.toolUseId ?? '', accepted: true });
    await until(() => expect(said().some((s) => s.startsWith('mcp: '))).toBe(true));
    const reply = JSON.parse(
      said()
        .find((s) => s.startsWith('mcp: '))
        ?.slice(5) ?? '{}',
    );
    expect(reply).toEqual({
      tools: ['submit_verdict'],
      result: {
        content: [{ type: 'text', text: 'Verdict filed. Your review is done.' }],
        isError: false,
      },
    });
    // Filed, the turn ending is no failure.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(types(events)).not.toContain('error');
  });

  it('ends a waiting verdict when the review closes', async () => {
    const host = stubHost();
    const { events, session } = review({ tools: host.host, script: [{ waitCancel: true }] });
    await until(() => expect(host.tools()).not.toBeNull());
    const reply = host.tools()?.call({ name: 'submit_verdict', arguments: PASS });
    await until(() => expect(submitted(events)).toHaveLength(1));
    session.close();
    await expect(reply).resolves.toEqual({
      text: 'Not accepted: The review has ended.',
      isError: true,
    });
    await expect(host.tools()?.call({ name: 'submit_verdict', arguments: PASS })).resolves.toEqual({
      text: 'Not accepted: The review has ended.',
      isError: true,
    } satisfies ToolResult);
    await until(() => expect(host.closed()).toBe(1));
  });
});

describe('AcpReview: a reviewer only reads (§5.5, #201)', () => {
  const ask = (kind: string) => ({
    permission: {
      toolCall: { toolCallId: `t-${kind}`, title: kind, kind },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'always', name: 'Always', kind: 'allow_always' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    },
  });

  it('allows reading and searching when asked, and refuses edits and commands', async () => {
    const { said, events } = review({
      script: [ask('read'), ask('search'), ask('edit'), ask('execute'), ask('fetch')],
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(said()).toEqual([
      'permission: {"outcome":"selected","optionId":"yes"}',
      'permission: {"outcome":"selected","optionId":"yes"}',
      'permission: {"outcome":"selected","optionId":"no"}',
      'permission: {"outcome":"selected","optionId":"no"}',
      'permission: {"outcome":"selected","optionId":"no"}',
    ]);
  });

  it('allows calling its own verdict tool when the agent asks, and no other server’s (#202)', async () => {
    const options = [
      { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
      { optionId: 'no', name: 'Reject', kind: 'reject_once' },
    ];
    const { said, events } = review({
      script: [
        // Codex announces the MCP call, then asks about it by id.
        {
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: 'v1',
            title: 'mcp.ibitsa.submit_verdict',
            kind: 'other',
            rawInput: { server: 'ibitsa', tool: 'submit_verdict', arguments: PASS },
          },
        },
        { permission: { toolCall: { toolCallId: 'v1', kind: 'execute' }, options } },
        // A standalone approval names the server instead.
        {
          permission: {
            toolCall: { toolCallId: 'v2', kind: 'execute', rawInput: { serverName: 'ibitsa' } },
            options,
          },
        },
        {
          permission: {
            toolCall: { toolCallId: 'v3', kind: 'execute', title: 'mcp.github.create_issue' },
            options,
          },
        },
      ],
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(said()).toEqual([
      'permission: {"outcome":"selected","optionId":"yes"}',
      'permission: {"outcome":"selected","optionId":"yes"}',
      'permission: {"outcome":"selected","optionId":"no"}',
    ]);
  });

  it('asks a sandbox for a read-only worktree, and refuses every new domain without asking (#200)', async () => {
    const requests: SpawnRequest[] = [];
    const { events } = review({
      spawn: (request) => {
        requests.push(request);
        return spawnAgent(request);
      },
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(requests[0]?.readOnly).toBe(true);
    await expect(requests[0]?.ask?.({ host: 'example.com', port: 443 })).resolves.toBe(false);
  });

  it('cancels a request it has no fitting option for', async () => {
    const { said, events } = review({
      script: [
        {
          permission: {
            toolCall: { toolCallId: 't1', title: 'Edit', kind: 'edit' },
            options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
          },
        },
      ],
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(said()).toEqual(['permission: {"outcome":"cancelled"}']);
  });
});

describe('AcpReview: a review that can’t finish (§5.5, #201)', () => {
  it('fails when the reviewer ends without a verdict', async () => {
    const { events } = review();
    await until(() => expect(types(events)).toContain('error'));
    expect(events.at(-1)).toEqual({ type: 'error', message: NO_VERDICT });
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
  });

  it(`stops a reviewer that takes more than ${REVIEW_STEPS} steps`, async () => {
    const steps = Array.from({ length: REVIEW_STEPS + 1 }, (_, i) => ({
      update: { sessionUpdate: 'tool_call', toolCallId: `t${i}`, title: 'Read', kind: 'read' },
    }));
    const { events, requests } = review({ script: [...steps, { waitCancel: true }] });
    await until(() => expect(types(events)).toContain('error'));
    expect(events.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', message: TOO_MANY_STEPS },
    ]);
    await until(() => expect(requests().map((r) => r.method)).toContain('session/cancel'));
  });

  it('reports the agent’s cost in USD, and stops a reviewer past its cap', async () => {
    const usage = (amount: number, currency = 'USD') => ({
      update: { sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount, currency } },
    });
    const { events } = review({
      start: { maxBudgetMicroUsd: 50_000 },
      script: [usage(0.02), usage(9, 'EUR'), usage(0.06), { waitCancel: true }],
    });
    await until(() => expect(types(events)).toContain('error'));
    expect(events.filter((e) => e.type !== 'sessionStarted')).toEqual([
      { type: 'usage', totalCost: 20_000 },
      { type: 'usage', totalCost: 60_000 },
      { type: 'error', message: OUT_OF_GOLD },
    ]);
  });

  it('fails at once without a tool bridge: there is no way to file a verdict', async () => {
    const { events } = review({ tools: null });
    await until(() => expect(types(events)).toContain('error'));
    expect(events).toEqual([{ type: 'error', message: NO_BRIDGE }]);
  });

  it('reports an agent that dies mid-review, once', async () => {
    const { events } = review({ script: [{ exit: 3 }] });
    await until(() => expect(types(events)).toContain('error'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const errors = events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ type: 'error', message: expect.stringContaining('code 3') });
  });
});
