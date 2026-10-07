import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HookCallback,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { CouncilEvent, ResearchBrief } from '@ibitsa/protocol';
import type { SittingStart } from '@ibitsa/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import type { ToolReply } from './elder-session.types';
import { COUNCIL_TOOLS, ROUND_TABLE_INSTRUCTIONS } from './round-table-session';

type Handler = (input: unknown) => Promise<ToolReply>;
type Call = (name: string, input: unknown) => Promise<ToolReply>;
type Script = (ctx: { call: Call; next: () => Promise<string> }) => AsyncGenerator<SDKMessage>;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A scripted SDK: tools run the way the CLI runs them, the PreToolUse hook first, then the handler. */
function fakeSdk(script: Script) {
  const calls: { options: Options }[] = [];
  const control = { closed: 0 };
  const handlers = new Map<string, Handler>();
  const inputs: string[] = [];
  let n = 0;
  const sdk: SdkModule = {
    query: ({ prompt, options = {} }) => {
      calls.push({ options });
      const iterator = (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
      const next = async () => {
        const r = await iterator.next();
        const text = r.done ? '' : String(r.value.message.content);
        inputs.push(text);
        return text;
      };
      const call: Call = async (name, input) => {
        const toolUseId = `tu${++n}`;
        for (const m of options.hooks?.PreToolUse ?? []) {
          for (const h of m.hooks as HookCallback[]) {
            await h(
              { tool_name: `mcp__ibitsa__${name}`, tool_use_id: toolUseId } as never,
              toolUseId,
              {
                signal: new AbortController().signal,
              },
            );
          }
        }
        const handler = handlers.get(name);
        if (!handler) throw new Error(`no tool ${name}`);
        return handler(input);
      };
      return Object.assign(script({ call, next }), {
        close: () => {
          control.closed++;
        },
      }) as unknown as Query;
    },
    createSdkMcpServer: ((config: {
      name: string;
      tools: { name: string; handler: Handler }[];
    }) => {
      for (const t of config.tools) handlers.set(t.name, t.handler);
      return { type: 'sdk', name: config.name };
    }) as unknown as SdkModule['createSdkMcpServer'],
    // biome-ignore lint/complexity/useMaxParams: mirrors the SDK's tool(name, description, schema, handler).
    tool: ((name: string, _d: string, _s: unknown, handler: Handler) => ({
      name,
      handler,
    })) as unknown as SdkModule['tool'],
  };
  return { sdk, calls, control, inputs };
}

const message = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const init = message({ type: 'system', subtype: 'init', session_id: 'sit-1' });
const result = (subtype: string) =>
  message({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: 0.3 });
const flush = () => new Promise((r) => setTimeout(r, 0));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await flush();
};

const BRIEF: ResearchBrief = {
  task: 'Add sign-in',
  files: [{ path: 'src/auth.ts', note: 'where sessions live' }],
  findings: [],
  slices: [],
  councillors: [],
  effort: { level: 'standard', reason: 'Decisions to make' },
  councillorEfforts: [],
  quickQuest: { recommended: false, reason: 'Needs decisions' },
};

function plugin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-council-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"ibitsa"}');
  mkdirSync(join(dir, 'skills', 'security'), { recursive: true });
  writeFileSync(
    join(dir, 'skills', 'security', 'SKILL.md'),
    '---\nname: security\nibitsa-councillor: true\n---\nYou are Security. Terse.\n\n## Planning\nLook at trust boundaries.\n\n## Review\nCheck the diff.\n',
  );
  return dir;
}

function run(script: Script, start: Partial<SittingStart> = {}) {
  const fake = fakeSdk(script);
  const events: CouncilEvent[] = [];
  const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
  dirs.push(home);
  const adapter = new ClaudeAdapter({
    env: () => ({}),
    home,
    pluginDirs: () => [plugin()],
    loadSdk: async () => fake.sdk,
  });
  const session = adapter.startSitting(
    {
      cwd: home,
      mode: 'roundTable',
      task: 'Add sign-in',
      brief: BRIEF,
      roster: [
        { councillorId: 'security', effort: 'standard' },
        { councillorId: 'ghost', effort: 'standard' },
      ],
      model: 'sonnet',
      maxBudgetMicroUsd: 2_000_000,
      ...start,
    },
    (e) => events.push(e),
  );
  return { ...fake, events, session };
}

const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };
const QUESTION = {
  councillorId: 'security',
  question: 'How long should a session last?',
  options: [
    { id: 'day', label: 'One day', tradeoff: 'Safer' },
    { id: 'month', label: '30 days', tradeoff: 'Convenient' },
  ],
  allowFreeText: true,
};

describe('the round table (#103)', () => {
  it('opens a read-only, capped session told the task, the brief, the roster and the budget', async () => {
    const { calls, inputs } = run(async function* ({ next }) {
      await next();
      yield result('success');
    });
    await until(() => inputs.length > 0);
    expect(calls[0]?.options).toMatchObject({
      model: 'sonnet',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ROUND_TABLE_INSTRUCTIONS },
      tools: ['Read', 'Grep', 'Glob'],
      allowedTools: ['Read', 'Grep', 'Glob', ...COUNCIL_TOOLS],
      maxBudgetUsd: 2,
      maxTurns: 120,
    });
    const opening = inputs[0] ?? '';
    expect(opening).toContain('Task:\nAdd sign-in');
    expect(opening).toContain('`src/auth.ts`: where sessions live');
    expect(opening).toContain(
      '### security (Security)\n\nYou are Security. Terse.\n\n## Planning\nLook at trust boundaries.',
    );
    expect(opening).not.toContain('Check the diff.');
    expect(opening).toContain('### ghost (ghost)\n\n(No skill file found: plan from its name.)');
    expect(opening).toContain('Your budget is $2.00');
  });

  it("files reports under their councillor and hands core's verdict back to the model", async () => {
    const replies: ToolReply[] = [];
    const { events, session } = run(async function* ({ call, next }) {
      await next();
      yield init;
      replies.push(
        await call('report', { councillorId: 'security', ...REPORT, bowOut: 'Nothing here' }),
      );
      replies.push(await call('propose_plan', { summary: 'Email only' }));
      yield result('success');
    });
    await until(() => events.some((e) => e.type === 'reportFiled'));
    expect(events.slice(0, 2)).toEqual([
      { type: 'sessionStarted', sessionId: 'sit-1' },
      {
        type: 'reportFiled',
        toolUseId: 'tu1',
        councillorId: 'security',
        report: { ...REPORT, bowOut: 'Nothing here' },
      },
    ]);
    session.completeTool({ toolUseId: 'tu1', accepted: true });
    await until(() => events.some((e) => e.type === 'planProposed'));
    expect(events.at(-1)).toEqual({
      type: 'planProposed',
      toolUseId: 'tu2',
      plan: { summary: 'Email only' },
    });
    session.completeTool({
      toolUseId: 'tu2',
      accepted: false,
      reason: 'Every councillor must report before a plan is proposed. Waiting for: ghost.',
    });
    await until(() => replies.length === 2);
    expect(replies[0]).toEqual({ content: [{ type: 'text', text: "Filed security's report." }] });
    expect(replies[1]).toEqual({
      content: [
        {
          type: 'text',
          text: 'Not accepted: Every councillor must report before a plan is proposed. Waiting for: ghost.',
        },
      ],
      isError: true,
    });
  });

  it('asks, ends its turn, hears "Why?" and the answers as messages, and speaks through say', async () => {
    const replies: ToolReply[] = [];
    const { events, session, inputs } = run(async function* ({ call, next }) {
      await next();
      replies.push(
        await call('ask_user', { questions: [{ ...QUESTION, recommendation: undefined }] }),
      );
      yield result('success');
      await next(); // "Why?"
      replies.push(
        await call('say', { councillorId: 'security', text: 'Stolen cookies.', questionId: 'q1' }),
      );
      yield result('success');
      await next(); // the answers
      replies.push(await call('propose_plan', { summary: 'Plan', detail: '- T1' }));
      yield result('success');
    });
    await until(() => events.some((e) => e.type === 'questionsAsked'));
    expect(events.at(-1)).toEqual({
      type: 'questionsAsked',
      toolUseId: 'tu1',
      questions: [QUESTION],
    });
    session.completeTool({ toolUseId: 'tu1', accepted: true });
    await until(() => replies.length === 1);
    expect(replies[0]?.content[0]?.text).toBe(
      'The questions are with the user. End your turn now: their answers will arrive as a message.',
    );
    session.message({
      kind: 'why',
      questionId: 'q1',
      councillorId: 'security',
      question: QUESTION.question,
      text: 'Why so short?',
    });
    await until(() => events.some((e) => e.type === 'said'));
    expect(inputs[1]).toContain(
      'The user asked security "Why?" about: "How long should a session last?" (questionId q1).\nThey added: Why so short?',
    );
    expect(events.find((e) => e.type === 'said')).toEqual({
      type: 'said',
      councillorId: 'security',
      text: 'Stolen cookies.',
      questionId: 'q1',
    });
    session.answer({ toolUseId: 'tu1', answers: [{ text: 'A week' }] });
    session.answer({ toolUseId: 'unknown', answers: [] });
    await until(() => events.some((e) => e.type === 'planProposed'));
    expect(inputs[2]).toBe(
      'The user answered:\n- security asked "How long should a session last?": In their words: A week\n\nCarry on: when every councillor has reported, propose the plan.',
    );
    expect(events.at(-1)).toMatchObject({ plan: { summary: 'Plan', detail: '- T1' } });
  });

  it('words change requests, added councillors and chosen options for the session', async () => {
    const { session, inputs } = run(async function* ({ call, next }) {
      await next();
      await call('ask_user', { questions: [QUESTION] });
      await next();
      await next();
      await next();
      yield result('success');
    });
    await until(() => inputs.length === 1);
    await flush();
    session.completeTool({ toolUseId: 'tu1', accepted: true });
    session.message({ kind: 'changeRequested', version: 2, text: 'Add Google' });
    session.message({ kind: 'councillorAdded', councillorId: 'security', effort: 'deep' });
    session.answer({ toolUseId: 'tu1', answers: [{ optionId: 'day' }] });
    await until(() => inputs.length === 4);
    expect(inputs[1]).toBe(
      'The user asked for changes to plan v2:\nAdd Google\n\nConsult again the councillors this change affects (they report again), then call propose_plan again.',
    );
    expect(inputs[2]).toContain(
      'The user added security (Security) to the council. They must report before the next plan.',
    );
    expect(inputs[3]).toContain('security asked "How long should a session last?": One day');
  });

  it.each([
    ['error_max_budget_usd', 'The council ran out of gold. Its reports so far are kept.'],
    ['error_max_turns', 'The council took too many steps.'],
    ['error_during_execution', 'The sitting stopped: error during execution.'],
  ])('reports %s once, with the cost', async (subtype, text) => {
    const { events } = run(async function* ({ next }) {
      await next();
      yield result('success');
      yield result(subtype);
      yield result(subtype);
    });
    await until(() => events.filter((e) => e.type === 'usage').length === 3);
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', message: text }]);
    expect(events.filter((e) => e.type === 'usage')[0]).toEqual({
      type: 'usage',
      totalCost: 300_000,
      byModel: [],
    });
  });

  it('turns down waiting tool calls when closed, and says nothing more', async () => {
    const replies: ToolReply[] = [];
    const { session, events, control } = run(async function* ({ call, next }) {
      await next();
      replies.push(await call('report', { councillorId: 'security', ...REPORT }));
      yield result('error_during_execution');
    });
    await until(() => events.some((e) => e.type === 'reportFiled'));
    session.close();
    await until(() => replies.length === 1);
    expect(replies[0]).toMatchObject({
      isError: true,
      content: [{ text: 'Not accepted: The sitting has ended.' }],
    });
    expect(control.closed).toBe(1);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });

  it('reports a failure to start', async () => {
    const events: CouncilEvent[] = [];
    new ClaudeAdapter({
      env: () => ({}),
      loadSdk: async () => {
        throw new Error('no SDK');
      },
    }).startSitting(
      {
        cwd: '/r',
        mode: 'roundTable',
        task: 't',
        brief: null,
        roster: [],
        model: 'haiku',
        maxBudgetMicroUsd: 1,
      },
      (e) => events.push(e),
    );
    await until(() => events.length > 0);
    expect(events).toEqual([{ type: 'error', message: 'no SDK' }]);
  });
});

describe('a council whose context was kept (#167)', () => {
  it('resumes the kept session, and starts fresh otherwise', async () => {
    const kept = run(
      async function* () {
        yield result('success');
      },
      { resume: { sessionId: 'council-old', kept: true } },
    );
    const fresh = run(async function* () {
      yield result('success');
    });
    await flush();
    expect(kept.calls[0]?.options.resume).toBe('council-old');
    expect(fresh.calls[0]?.options).not.toHaveProperty('resume');
  });
});

describe('resuming the lead session (#166, #169)', () => {
  it('resumes by id and sends only the given message: a question mid-campaign, answered with say', async () => {
    const { calls, inputs, events } = run(
      async function* ({ call, next }) {
        await next();
        await call('say', { councillorId: 'security', text: 'Keep the cookie httpOnly.' });
        yield result('success');
      },
      {
        resume: { sessionId: 'sit-1', prompt: 'The user asks security: cookies?' },
        maxBudgetMicroUsd: 500_000,
      },
    );
    await until(() => events.some((e) => e.type === 'usage'));
    expect(calls[0]?.options).toMatchObject({ resume: 'sit-1', maxBudgetUsd: 0.5 });
    expect(inputs).toEqual(['The user asks security: cookies?']);
    expect(events).toContainEqual({
      type: 'said',
      councillorId: 'security',
      text: 'Keep the cookie httpOnly.',
    });
  });

  it('resumes in separate chambers too, with the chambers to dispatch', async () => {
    const { calls, inputs } = run(
      async function* ({ next }) {
        await next();
        yield result('success');
      },
      { mode: 'chambers', resume: { sessionId: 'sit-2', prompt: 'A question' } },
    );
    await until(() => inputs.length > 0);
    expect(calls[0]?.options).toMatchObject({ resume: 'sit-2' });
    expect(Object.keys(calls[0]?.options.agents ?? {})).toContain('security');
    expect(inputs).toEqual(['A question']);
  });

  it('sends nothing when resumed without a message', async () => {
    const { calls } = run(
      async function* () {
        yield result('success');
      },
      { resume: { sessionId: 'sit-3' } },
    );
    await until(() => calls.length > 0);
    await flush();
    expect(calls[0]?.options).toMatchObject({ resume: 'sit-3' });
  });
});

describe('what a sitting cost (#106)', () => {
  it('reports cost per model, and tokens per councillor from the chambers it started', async () => {
    const assistant = (m: Record<string, unknown>) => message({ type: 'assistant', ...m });
    const { events } = run(async function* ({ next }) {
      await next();
      // The lead session starts a chamber for security (and its deeper pass); their messages carry its id.
      yield assistant({
        parent_tool_use_id: null,
        message: {
          content: [
            { type: 'text', text: 'Dispatching' },
            {
              type: 'tool_use',
              id: 'agent-1',
              name: 'Agent',
              input: { subagent_type: 'security' },
            },
            {
              type: 'tool_use',
              id: 'agent-2',
              name: 'Task',
              input: { subagent_type: 'security-deep' },
            },
            { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'x' } },
          ],
        },
      });
      yield assistant({
        parent_tool_use_id: 'agent-1',
        message: {
          content: [],
          usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 300 },
        },
      });
      yield assistant({
        parent_tool_use_id: 'agent-2',
        message: {
          content: [],
          usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 5 },
        },
      });
      yield assistant({
        parent_tool_use_id: 'unknown',
        message: { content: [], usage: { input_tokens: 9, output_tokens: 9 } },
      });
      yield message({
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.3,
        modelUsage: {
          'claude-sonnet': {
            inputTokens: 1000,
            outputTokens: 200,
            cacheReadInputTokens: 5000,
            cacheCreationInputTokens: 400,
            costUSD: 0.25,
          },
        },
      });
    });
    await until(() => events.some((e) => e.type === 'usage'));
    expect(events.find((e) => e.type === 'usage')).toEqual({
      type: 'usage',
      totalCost: 300_000,
      byModel: [
        {
          model: 'claude-sonnet',
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 5000,
          cacheWriteTokens: 400,
          costMicroUsd: 250_000,
        },
      ],
      byCouncillor: [{ councillorId: 'security', tokens: 485 }],
    });
  });

  it('names the council prompts by a hash, the same every time', () => {
    const adapter = new ClaudeAdapter({ env: () => ({}) });
    expect(adapter.councilPromptVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(new ClaudeAdapter({ env: () => ({}) }).councilPromptVersion).toBe(
      adapter.councilPromptVersion,
    );
  });
});
