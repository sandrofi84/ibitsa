import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { LessonsEvent } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import type { ToolReply } from './elder-session.types';
import { LESSONS_INSTRUCTIONS, LESSONS_TOOL } from './lessons-session';

type Handler = (input: unknown) => Promise<ToolReply>;
type Tool = { name: string; handler: Handler };
type Script = (ctx: { submit: Handler }) => AsyncGenerator<SDKMessage>;

/** A scripted SDK: query() records its call and plays back a script that can call submit_lessons. */
function fakeSdk(script: Script) {
  const calls: { prompt: unknown; options: Options }[] = [];
  const control = { closed: 0 };
  const tools: Tool[] = [];
  const sdk: SdkModule = {
    query: ({ prompt, options = {} }) => {
      calls.push({ prompt, options });
      const submit: Handler = (input) => {
        const tool = tools.find((t) => t.name === 'submit_lessons');
        if (!tool) throw new Error('no submit_lessons');
        return tool.handler(input);
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
const init = message({ type: 'system', subtype: 'init', session_id: 'sess-l' });
const result = (subtype: string, cost = 0.02) =>
  message({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: cost });
const flush = () => new Promise((r) => setTimeout(r, 0));

function run(script: Script) {
  const fake = fakeSdk(script);
  const events: LessonsEvent[] = [];
  const adapter = new ClaudeAdapter({
    env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
    loadSdk: async () => fake.sdk,
  });
  const session = adapter.startLessons(
    {
      cwd: '/repo',
      title: 'Sign-in',
      material: 'Task "Auth": passed after 2 rounds.',
      model: 'haiku',
      maxBudgetMicroUsd: 50_000,
    },
    (e) => events.push(e),
  );
  return { ...fake, events, session };
}

describe('the lessons session (#167)', () => {
  it('runs a capped Haiku session with only submit_lessons, given the reviews', async () => {
    const { calls } = run(async function* () {
      yield result('success');
    });
    await flush();
    expect(calls[0]?.prompt).toBe(
      'The campaign "Sign-in" has ended. What happened in its reviews:\n\nTask "Auth": passed after 2 rounds.',
    );
    expect(calls[0]?.options).toMatchObject({
      cwd: '/repo',
      model: 'haiku',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: LESSONS_INSTRUCTIONS },
      tools: [],
      allowedTools: [LESSONS_TOOL],
      maxBudgetUsd: 0.05,
    });
    const decision = await calls[0]?.options.canUseTool?.('Read', {}, {
      signal: new AbortController().signal,
      toolUseID: 'x',
    } as never);
    expect(decision).toMatchObject({ behavior: 'deny' });
  });

  it('files trimmed lessons, sends back an empty set, then reports its cost', async () => {
    let rejected: ToolReply | null = null;
    let accepted: ToolReply | null = null;
    const { events } = run(async function* ({ submit }) {
      yield init;
      rejected = await submit({ lessons: ['  '] });
      accepted = await submit({ lessons: [' Brief the hero on hashing. ', ''] });
      yield result('success', 0.03);
    });
    await expect.poll(() => events.length).toBe(3);
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'sess-l' },
      { type: 'lessonsSubmitted', lessons: ['Brief the hero on hashing.'] },
      { type: 'usage', totalCost: 30_000 },
    ]);
    expect(rejected).toMatchObject({ isError: true });
    expect(accepted).toEqual({ content: [{ type: 'text', text: 'Lessons filed. You are done.' }] });
  });

  it.each([
    ['error_max_budget_usd', 'The elder ran out of gold before filing lessons.'],
    ['error_max_turns', 'The lessons stopped: error max turns.'],
    ['success', 'The elder finished without filing lessons.'],
  ])('reports one error when it ends on %s without lessons', async (subtype, text) => {
    const { events } = run(async function* () {
      yield result(subtype);
    });
    await expect.poll(() => events.length).toBe(2);
    expect(events).toEqual([
      { type: 'usage', totalCost: 20_000 },
      { type: 'error', message: text },
    ]);
  });

  it('reports a failing SDK, and closing stays quiet', async () => {
    const broken = run(async function* () {
      yield init;
      throw new Error('spawn failed');
    });
    await expect
      .poll(() => broken.events.at(-1))
      .toEqual({ type: 'error', message: 'spawn failed' });
    const closed = run(async function* () {
      await flush();
      yield result('error_during_execution');
    });
    closed.session.close();
    await flush();
    await flush();
    expect(closed.control.closed).toBe(1);
    expect(closed.events.filter((e) => e.type === 'error')).toEqual([]);
  });
});

describe("compacting a council's session (#167)", () => {
  it('resumes it with /compact and waits for the result', async () => {
    const { sdk, calls } = fakeSdk(async function* () {
      yield init;
      yield result('success');
    });
    const adapter = new ClaudeAdapter({
      env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
      claudeCodePath: () => '/bin/claude',
      loadSdk: async () => sdk,
    });
    await adapter.compactCouncil({ cwd: '/repo', sessionId: 'council-1' });
    expect(calls[0]?.prompt).toBe('/compact');
    expect(calls[0]?.options).toMatchObject({
      cwd: '/repo',
      resume: 'council-1',
      maxTurns: 1,
      pathToClaudeCodeExecutable: '/bin/claude',
    });
  });
});
