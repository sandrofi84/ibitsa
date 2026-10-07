import type { Options, PermissionResult, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { CouncillorInfo, ElderEvent, ResearchBrief } from '@ibitsa/protocol';
import type { ElderStart } from '@ibitsa/runtime';
import { describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import { BRIEF_TOOL, ELDER_INSTRUCTIONS } from './elder-session';
import type { ToolReply } from './elder-session.types';

type Tool = { name: string; handler: (input: unknown) => Promise<ToolReply> };
type Script = (ctx: {
  submit: (input: unknown) => Promise<ToolReply>;
}) => AsyncGenerator<SDKMessage>;

/** A scripted SDK: query() records its call and plays back a script that can call submit_brief. */
function fakeSdk(script: Script) {
  const calls: { prompt: unknown; options: Options }[] = [];
  const control = { closed: 0 };
  const tools: Tool[] = [];
  const sdk: SdkModule = {
    query: ({ prompt, options = {} }) => {
      calls.push({ prompt, options });
      const submit = (input: unknown) => {
        const tool = tools.find((t) => t.name === 'submit_brief');
        if (!tool) throw new Error('no submit_brief');
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
    tool: ((name: string, _d: string, _s: unknown, handler: Tool['handler']) => ({
      name,
      handler,
    })) as unknown as SdkModule['tool'],
  };
  return { sdk, calls, control };
}

const message = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const init = message({ type: 'system', subtype: 'init', session_id: 'sess-9' });
const result = (subtype: string, cost = 0.04) =>
  message({ type: 'result', subtype, is_error: subtype !== 'success', total_cost_usd: cost });
const toolUse = (
  name: string,
  { input, parent = null }: { input: unknown; parent?: string | null },
) =>
  message({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: {
      content: [
        { type: 'text', text: 'Looking' },
        { type: 'tool_use', name, input },
      ],
    },
  });
const flush = () => new Promise((r) => setTimeout(r, 0));

const tester = { id: 'tester', title: 'Tester', description: 'Tests' } as CouncillorInfo;
const BRIEF: ResearchBrief = {
  task: 'Strip accents',
  files: [{ path: 'src/slug.ts', note: 'slugify' }],
  findings: [],
  slices: [{ councillorId: 'tester', summary: 'Accent cases', pointers: [] }],
  councillors: [{ councillorId: 'tester', reason: 'Behaviour' }],
  effort: { level: 'light', reason: 'Small' },
  councillorEfforts: [{ councillorId: 'tester', level: 'light', reason: 'Few cases' }],
  quickQuest: { recommended: true, reason: 'Small' },
};

function run(
  script: Script,
  {
    councillors = [tester],
    past = {},
  }: { councillors?: CouncillorInfo[]; past?: Partial<ElderStart> } = {},
) {
  const fake = fakeSdk(script);
  const events: ElderEvent[] = [];
  const adapter = new ClaudeAdapter({
    env: () => ({ ANTHROPIC_API_KEY: 'sk-test' }),
    claudeCodePath: () => '/bin/claude',
    loadSdk: async () => fake.sdk,
  });
  const session = adapter.startElder(
    {
      cwd: '/repo',
      task: 'Strip accents in slugify',
      councillors,
      model: 'haiku',
      maxBudgetMicroUsd: 250_000,
      pastRecords: [],
      keptCouncil: null,
      ...past,
    },
    (e) => events.push(e),
  );
  return { ...fake, events, session };
}

describe('the elder session (#101)', () => {
  it('runs a read-only, capped research session on the chosen model, told the task and the roster', async () => {
    const { calls } = run(async function* () {
      yield result('success');
    });
    await flush();
    const call = calls[0];
    expect(call?.prompt).toBe(
      'Research this task and file a brief.\n\nTask:\nStrip accents in slugify\n\nCouncillors you may recommend:\n- tester (Tester): Tests',
    );
    expect(call?.options).toMatchObject({
      cwd: '/repo',
      model: 'haiku',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ELDER_INSTRUCTIONS },
      settingSources: ['project'],
      tools: ['Read', 'Grep', 'Glob'],
      allowedTools: ['Read', 'Grep', 'Glob', BRIEF_TOOL],
      maxTurns: 40,
      maxBudgetUsd: 0.25,
      pathToClaudeCodeExecutable: '/bin/claude',
    });
    const decision = (await call?.options.canUseTool?.('Bash', {}, {
      signal: new AbortController().signal,
      toolUseID: 't1',
    } as never)) as PermissionResult;
    expect(decision).toEqual({ behavior: 'deny', message: 'The elder only reads the code.' });
  });

  it('reports the session, what it reads, the brief and the cost', async () => {
    const replies: ToolReply[] = [];
    const { events } = run(async function* ({ submit }) {
      yield init;
      yield toolUse('Read', { input: { file_path: 'src/slug.ts' } });
      yield toolUse('Grep', { input: { pattern: 'slugify' } });
      yield toolUse('Glob', { input: { pattern: '**/*.test.ts' } });
      yield toolUse('Read', { input: { file_path: 'inside a subagent' }, parent: 'parent-1' });
      yield toolUse('LS', { input: null });
      yield toolUse(BRIEF_TOOL, { input: BRIEF });
      replies.push(await submit(BRIEF));
      yield result('success');
    });
    await flush();
    expect(events).toEqual([
      { type: 'sessionStarted', sessionId: 'sess-9' },
      { type: 'activity', text: 'Reading src/slug.ts' },
      { type: 'activity', text: 'Searching for slugify' },
      { type: 'activity', text: 'Looking for **/*.test.ts' },
      { type: 'activity', text: 'Using LS' },
      { type: 'activity', text: 'Writing the brief' },
      { type: 'briefSubmitted', brief: BRIEF },
      { type: 'usage', totalCost: 40_000 },
    ]);
    expect(replies).toEqual([
      { content: [{ type: 'text', text: 'Brief received. Your research is done.' }] },
    ]);
  });

  it('hands a bad brief back to the elder to fix, naming the problems', async () => {
    const replies: ToolReply[] = [];
    const { events } = run(async function* ({ submit }) {
      replies.push(
        await submit({ ...BRIEF, councillors: [{ councillorId: 'bard', reason: 'Songs' }] }),
      );
      replies.push(await submit({ ...BRIEF, task: '' }));
      yield result('success');
    });
    await flush();
    expect(replies.map((r) => r.isError)).toEqual([true, true]);
    expect(replies[0]?.content[0]?.text).toBe(
      `The brief wasn't accepted:\n- "bard" isn't a councillor. Choose from: tester.\nFix these and call submit_brief again.`,
    );
    expect(replies[1]?.content[0]?.text).toContain('- task: ');
    expect(events.filter((e) => e.type === 'briefSubmitted')).toEqual([]);
  });

  it('says when it can recommend no one', async () => {
    const { calls } = run(
      async function* () {
        yield result('success');
      },
      { councillors: [] },
    );
    await flush();
    expect(calls[0]?.prompt).toContain(
      '(none: recommend no councillors, and say whether a quick quest fits)',
    );
  });

  it.each([
    ['success', 'The elder finished without writing a brief.'],
    ['error_max_budget_usd', 'The elder ran out of gold before finishing the brief.'],
    ['error_max_turns', 'The elder took too many steps without finishing the brief.'],
    ['error_during_execution', 'The research stopped: error during execution.'],
  ])('reports ending with %s and no brief as an error', async (subtype, text) => {
    const { events } = run(async function* () {
      yield result(subtype);
    });
    await flush();
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', message: text }]);
  });

  it('reports a failure to start', async () => {
    const events: ElderEvent[] = [];
    new ClaudeAdapter({
      env: () => ({}),
      loadSdk: async () => {
        throw new Error('no SDK');
      },
    }).startElder(
      {
        cwd: '/r',
        task: 't',
        councillors: [],
        model: 'haiku',
        maxBudgetMicroUsd: 1,
        pastRecords: [],
        keptCouncil: null,
      },
      (e) => events.push(e),
    );
    await flush();
    expect(events).toEqual([{ type: 'error', message: 'no SDK' }]);
  });

  it('once its brief is accepted, closing it lets the last turn finish, so its cost still arrives', async () => {
    const { events, session, control } = run(async function* ({ submit }) {
      await submit(BRIEF);
      session.close();
      await flush();
      yield result('success', 0.07);
    });
    await expect.poll(() => events.at(-1)).toEqual({ type: 'usage', totalCost: 70_000 });
    expect(control.closed).toBe(0);
  });

  it('says nothing more once closed', async () => {
    const { events, session, control } = run(async function* () {
      await flush();
      yield result('error_during_execution');
    });
    session.close();
    await flush();
    await flush();
    expect(control.closed).toBe(1);
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
  });

  it('shows the elder past campaigns and a kept council, and checks the related ones (#168)', async () => {
    let rejected: ToolReply | null = null;
    const { calls } = run(
      async function* ({ submit }) {
        rejected = await submit({
          ...BRIEF,
          relatedCampaigns: [{ campaignId: 'c-nope', title: 'Nope', why: 'x' }],
        });
        yield result('success');
      },
      {
        past: {
          pastRecords: [
            {
              campaignId: 'c-old',
              title: 'Sign-in',
              date: '2026-10-01',
              status: 'finished',
              summary: 'Email sign-in.',
              path: '.ibitsa/campaigns/c-old/record.md',
            },
          ],
          keptCouncil: { from: 'Sign-in' },
        },
      },
    );
    await flush();
    const prompt = String(calls[0]?.prompt);
    expect(prompt).toContain(
      'Past campaigns (their records, newest first):\n- c-old · 2026-10-01 · Sign-in (finished): Email sign-in. — .ibitsa/campaigns/c-old/record.md',
    );
    expect(prompt).toContain('The council\'s context was kept from the campaign "Sign-in".');
    expect(JSON.stringify(rejected)).toContain('\\"c-nope\\" isn\'t a past campaign');
  });
});
