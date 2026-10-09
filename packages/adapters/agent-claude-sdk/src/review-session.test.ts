import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ReviewEvent } from '@ibitsa/protocol';
import type { ReviewStart } from '@ibitsa/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import type { ToolReply } from './elder-session.types';
import { REVIEW_INSTRUCTIONS, VERDICT_TOOL } from './review-session';

type Handler = (input: unknown, extra?: unknown) => Promise<ToolReply>;
type Tool = { name: string; handler: Handler };
type Script = (ctx: { submit: Handler }) => AsyncGenerator<SDKMessage>;

/** A scripted SDK: query() records its call and plays back a script that can call submit_verdict. */
function fakeSdk(script: Script) {
  const calls: { prompt: unknown; options: Options }[] = [];
  const control = { closed: 0 };
  const tools: Tool[] = [];
  const sdk: SdkModule = {
    query: ({ prompt, options = {} }) => {
      calls.push({ prompt, options });
      const submit: Handler = (input, extra) => {
        const tool = tools.find((t) => t.name === 'submit_verdict');
        if (!tool) throw new Error('no submit_verdict');
        return tool.handler(input, extra);
      };
      return Object.assign(script({ submit }), {
        close: () => {
          control.closed++;
        },
      }) as unknown as Query;
    },
    createSdkMcpServer: ((config: { name: string; tools: Tool[] }) => {
      tools.push(...config.tools);
      return { type: 'sdk', name: config.name };
    }) as unknown as SdkModule['createSdkMcpServer'],
    // biome-ignore lint/complexity/useMaxParams: mirrors the SDK's tool(name, description, schema, handler).
    tool: ((name: string, _d: string, _s: unknown, handler: Handler) => ({
      name,
      handler,
    })) as unknown as SdkModule['tool'],
  };
  return { sdk, calls, control };
}

const message = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const init = message({ type: 'system', subtype: 'init', session_id: 'sess-r' });
const result = (subtype: string, cost = 0.12) =>
  message({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: cost });
const flush = () => new Promise((r) => setTimeout(r, 0));
const callId = (id: string) => ({ _meta: { 'claudecode/toolUseId': id } });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** A repository with a Security councillor whose skill has a `## Review` section. */
function repo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ibitsa-review-'));
  dirs.push(cwd);
  const dir = join(cwd, '.claude', 'skills', 'security');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: security\nibitsa-councillor: true\n---\nYou guard secrets.\n\n## Planning\nThreat model.\n\n## Review\nCheck inputs.\n',
  );
  return cwd;
}

const VERDICT = {
  verdict: 'changes',
  findings: [
    { severity: 'blocking', kind: 'security', file: 'src/a.ts', line: 3, message: 'Escape it' },
  ],
};

function run(script: Script, change: Partial<ReviewStart> = {}) {
  const fake = fakeSdk(script);
  const events: ReviewEvent[] = [];
  const cwd = repo();
  const adapter = new ClaudeAdapter({
    env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
    loadSdk: async () => fake.sdk,
    home: cwd,
  });
  const session = adapter.startReview(
    {
      cwd,
      councillorId: 'security',
      model: 'sonnet',
      maxBudgetMicroUsd: 400_000,
      round: 1,
      diff: 'diff --git a/src/a.ts b/src/a.ts\n+html(input)',
      task: { title: 'Render the name', description: 'Show it on the page' },
      criteria: ['No unescaped input'],
      decisions: [
        {
          id: 'D1',
          title: 'Templating',
          raisedBy: 'elder',
          chosen: 'Plain strings',
          alternatives: [],
          why: 'Small',
          affects: [],
        },
      ],
      checks: [
        { command: 'pnpm test', ok: true, output: '' },
        { command: 'pnpm lint', ok: false, output: 'a.ts: unused' },
      ],
      ...change,
    },
    (e) => events.push(e),
  );
  return { ...fake, events, session };
}

describe('the review session (#138)', () => {
  it("runs a read-only, capped session briefed with the councillor's review guidance and the work", async () => {
    const { calls } = run(async function* () {
      yield result('success');
    });
    await flush();
    const call = calls[0];
    expect(call?.options).toMatchObject({
      model: 'sonnet',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: REVIEW_INSTRUCTIONS },
      tools: ['Read', 'Grep', 'Glob'],
      allowedTools: ['Read', 'Grep', 'Glob', VERDICT_TOOL],
      maxBudgetUsd: 0.4,
    });
    expect(call?.options).not.toHaveProperty('pathToClaudeCodeExecutable');
    const decision = await call?.options.canUseTool?.('Edit', {}, {
      signal: new AbortController().signal,
      toolUseID: 'x',
    } as never);
    expect(decision).toMatchObject({ behavior: 'deny' });
    const prompt = String(call?.prompt);
    expect(prompt).toContain('You are security (Security), reviewing round 1');
    expect(prompt).toContain('You guard secrets.\n\n## Review\nCheck inputs.');
    expect(prompt).not.toContain('Threat model');
    expect(prompt).toContain('The task: Render the name\nShow it on the page');
    expect(prompt).toContain('- No unescaped input');
    expect(prompt).toContain('- D1 Templating: Plain strings. Small');
    expect(prompt).toContain('`pnpm test`: passed');
    expect(prompt).toContain('`pnpm lint`: failed\na.ts: unused');
    expect(prompt).toContain("The task's changes:\n\ndiff --git");
  });

  it('on a later round, says the diff is what changed since', async () => {
    const { calls } = run(
      async function* () {
        yield result('success');
      },
      { round: 2, criteria: [], decisions: [], checks: [], diff: '' },
    );
    await flush();
    const prompt = String(calls[0]?.prompt);
    expect(prompt).toContain('What changed since your last review:\n\n(empty diff)');
    expect(prompt).toContain('(none: review for bugs, security and things that broke)');
    expect(prompt).toContain('(none ran)');
  });

  it('files the verdict under its call id, returns the ruling, and reports its cost', async () => {
    let rejected: Promise<ToolReply> | null = null;
    let accepted: Promise<ToolReply> | null = null;
    const { events, session } = run(async function* ({ submit }) {
      yield init;
      rejected = submit(VERDICT, callId('t1'));
      await flush();
      session.completeTool({ toolUseId: 't1', accepted: false, reason: 'Name a criterion' });
      accepted = submit(VERDICT, callId('t2'));
      await flush();
      session.completeTool({ toolUseId: 't2', accepted: true });
      yield result('success');
    });
    await expect.poll(() => events.length).toBe(4);
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'sess-r' },
      { type: 'verdictSubmitted', toolUseId: 't1', verdict: VERDICT },
      { type: 'verdictSubmitted', toolUseId: 't2', verdict: VERDICT },
      { type: 'usage', totalCost: 120_000 },
    ]);
    expect(await rejected).toEqual({
      content: [{ type: 'text', text: 'Not accepted: Name a criterion' }],
      isError: true,
    });
    expect(await accepted).toEqual({
      content: [{ type: 'text', text: 'Verdict filed. Your review is done.' }],
    });
  });

  it.each([
    [
      'error_max_budget_usd',
      'The reviewer reached the spend cap you set (ibitsa.council.reviewBudgetUsd) before its verdict. Raise or clear it in the Guild Hall, then run it again.',
    ],
    ['error_max_turns', 'The reviewer took too many steps without a verdict.'],
    ['error_during_execution', 'The review stopped: error during execution.'],
  ])('reports one error when it ends on %s without a verdict', async (subtype, text) => {
    const { events } = run(async function* () {
      yield result(subtype);
    });
    await flush();
    await flush();
    expect(events).toEqual([
      { type: 'usage', totalCost: 120_000 },
      { type: 'error', message: text },
    ]);
  });

  it('reports an error when it finishes without a verdict, or the SDK fails', async () => {
    const quiet = run(async function* () {
      yield result('success');
    });
    const broken = run(async function* () {
      yield init;
      throw new Error('spawn failed');
    });
    await flush();
    await flush();
    expect(quiet.events.at(-1)).toEqual({
      type: 'error',
      message: 'The reviewer finished without a verdict.',
    });
    expect(broken.events.at(-1)).toEqual({ type: 'error', message: 'spawn failed' });
  });

  it('once its verdict is filed, closing it lets the last turn finish, so its cost still arrives', async () => {
    let finish: () => void = () => {};
    const ended = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { events, session, control } = run(async function* ({ submit }) {
      const filed = submit(VERDICT, callId('t1'));
      await flush();
      // The runtime's order: the ruling and the close in one step.
      session.completeTool({ toolUseId: 't1', accepted: true });
      session.close();
      expect(await filed).toEqual({
        content: [{ type: 'text', text: 'Verdict filed. Your review is done.' }],
      });
      await ended;
      yield result('success');
    });
    await flush();
    await flush();
    expect(control.closed).toBe(0);
    finish();
    await expect.poll(() => events.at(-1)).toEqual({ type: 'usage', totalCost: 120_000 });
  });

  it('closing it answers a waiting verdict, stops the query and stays quiet', async () => {
    let pending: Promise<ToolReply> | null = null;
    const { events, session, control } = run(async function* ({ submit }) {
      yield init;
      pending = submit(VERDICT, callId('t1'));
      await pending;
    });
    await flush();
    session.close();
    expect(await pending).toMatchObject({ isError: true });
    await flush();
    expect(control.closed).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['sessionStarted', 'verdictSubmitted']);
  });
});
