import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  HookCallback,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { CouncilEvent, ResearchBrief } from '@ibitsa/protocol';
import type { SittingStart } from '@ibitsa/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAMBERS_INSTRUCTIONS, chamberPrompt } from './chambers-session';
import { ClaudeAdapter } from './claude-adapter';
import type { SdkModule } from './claude-adapter.types';
import type { ToolReply } from './elder-session.types';

type Handler = (input: unknown, extra?: unknown) => Promise<ToolReply>;
/** A tool call, from the elder's own thread or from inside a chamber (`agent`). */
type Call = (name: string, extra: { input: unknown; agent?: string }) => Promise<ToolReply>;
/** A call whose hook has run; its handler runs when `finish` is called, with Claude Code's metadata. */
type Begin = (
  name: string,
  extra: { input: unknown; agent?: string },
) => Promise<() => Promise<ToolReply>>;
type Script = (ctx: {
  call: Call;
  begin: Begin;
  next: () => Promise<string>;
}) => AsyncGenerator<SDKMessage>;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A scripted SDK: tools run the way the CLI runs them, the PreToolUse hook first, then the handler. */
function fakeSdk(script: Script) {
  const calls: { options: Options }[] = [];
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
      const begin: Begin = async (name, { input, agent }) => {
        const toolUseId = `tu${++n}`;
        const hookInput = {
          tool_name: `mcp__ibitsa__${name}`,
          tool_use_id: toolUseId,
          ...(agent ? { agent_id: `a-${agent}`, agent_type: agent } : {}),
        };
        for (const m of options.hooks?.PreToolUse ?? []) {
          for (const h of m.hooks as HookCallback[]) {
            await h(hookInput as never, toolUseId, { signal: new AbortController().signal });
          }
        }
        const handler = handlers.get(name);
        if (!handler) throw new Error(`no tool ${name}`);
        return () => handler(input, { _meta: { 'claudecode/toolUseId': toolUseId } });
      };
      const call: Call = async (name, { input, agent }) => {
        const toolUseId = `tu${++n}`;
        const hookInput = {
          tool_name: `mcp__ibitsa__${name}`,
          tool_use_id: toolUseId,
          ...(agent ? { agent_id: `a-${agent}`, agent_type: agent } : {}),
        };
        for (const m of options.hooks?.PreToolUse ?? []) {
          for (const h of m.hooks as HookCallback[]) {
            await h(hookInput as never, toolUseId, { signal: new AbortController().signal });
          }
        }
        const handler = handlers.get(name);
        if (!handler) throw new Error(`no tool ${name}`);
        return handler(input);
      };
      return Object.assign(script({ call, begin, next }), { close: () => {} }) as unknown as Query;
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
  return { sdk, calls, inputs };
}

const message = (m: Record<string, unknown>) => m as unknown as SDKMessage;
const result = message({
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0.2,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await flush();
};

const BRIEF: ResearchBrief = {
  task: 'Add sign-in',
  files: [{ path: 'src/auth.ts', note: 'where sessions live' }],
  findings: ['Sessions are cookies.'],
  slices: [
    {
      councillorId: 'security',
      summary: 'Session storage',
      pointers: [{ path: 'src/auth.ts', lines: '10-40', note: 'the cookie' }],
    },
  ],
  councillors: [],
  effort: { level: 'standard', reason: 'Decisions' },
  councillorEfforts: [],
  quickQuest: { recommended: false, reason: 'Decisions' },
};

function plugin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-chambers-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"ibitsa"}');
  for (const [id, title] of [
    ['security', 'Security'],
    ['tester', 'Tester'],
    ['designer', 'Designer'],
  ]) {
    mkdirSync(join(dir, 'skills', id ?? ''), { recursive: true });
    writeFileSync(
      join(dir, 'skills', id ?? '', 'SKILL.md'),
      `---\nname: ${id}\nibitsa-councillor: true\n---\nYou are ${title}.\n\n## Planning\nPlan ${id}.\n\n## Review\nReview ${id}.\n`,
    );
  }
  return dir;
}

function run(script: Script, start: Partial<SittingStart> = {}) {
  const fake = fakeSdk(script);
  const events: CouncilEvent[] = [];
  const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
  dirs.push(home);
  const session = new ClaudeAdapter({
    env: () => ({}),
    home,
    pluginDirs: () => [plugin()],
    loadSdk: async () => fake.sdk,
  }).startSitting(
    {
      cwd: home,
      mode: 'chambers',
      task: 'Add sign-in',
      brief: BRIEF,
      roster: [
        { councillorId: 'security', effort: 'deep', model: 'sonnet' },
        { councillorId: 'tester', effort: 'light', model: 'haiku' },
      ],
      model: 'sonnet',
      maxBudgetMicroUsd: 1_600_000,
      ...start,
    },
    (e) => events.push(e),
  );
  return { ...fake, events, session };
}

const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };

describe('separate chambers (#105)', () => {
  it('gives every councillor a chamber with its own briefing, model and steps, and a deeper pass at Deep', async () => {
    const { calls, inputs } = run(async function* ({ next }) {
      await next();
      yield result;
    });
    await until(() => inputs.length > 0);
    const options = calls[0]?.options;
    expect(options).toMatchObject({
      model: 'sonnet',
      maxBudgetUsd: 1.6,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: CHAMBERS_INSTRUCTIONS },
      tools: ['Read', 'Grep', 'Glob', 'Agent', 'Task'],
    });
    const agents = options?.agents ?? {};
    expect(Object.keys(agents).sort()).toEqual(['designer', 'security', 'security-deep', 'tester']);
    expect(agents.security).toMatchObject({
      model: 'sonnet',
      maxTurns: 25,
      tools: ['Read', 'Grep', 'Glob', 'mcp__ibitsa__report'],
    });
    expect(agents.tester).toMatchObject({ model: 'haiku', maxTurns: 8 });
    // A councillor not on the roster can still be added: standard effort on the elder's model.
    expect(agents.designer).toMatchObject({ model: 'sonnet', maxTurns: 15 });
    expect(agents['security-deep']).toMatchObject({ model: 'opus', maxTurns: 12 });
    const security = agents.security?.prompt ?? '';
    expect(security).toContain('You are Security.\n\n## Planning\nPlan security.');
    expect(security).not.toContain('Review security');
    expect(security).toContain(
      "Your slice of the elder's brief:\nSession storage\n- src/auth.ts:10-40: the cookie",
    );
    expect(security).toContain('What every councillor knows:\n- Sessions are cookies.');
    expect(security).toContain('The file map:\n- src/auth.ts: where sessions live');
    expect(agents.tester?.prompt).toContain('The elder gave you no slice');
    expect(agents['security-deep']?.prompt).toContain("You are security's deeper pass");
    expect(inputs[0]).toContain('- security (Security), deep effort (deeper pass: security-deep)');
    expect(inputs[0]).toContain('- tester (Tester), light effort');
    expect(inputs[0]).toContain("The sitting's budget is $1.60");
  });

  it("lets the elder dispatch only the council's own chambers", async () => {
    const { calls, inputs } = run(async function* ({ next }) {
      await next();
      yield result;
    });
    await until(() => inputs.length > 0);
    const decide = (tool: string, input: Record<string, unknown>) =>
      calls[0]?.options.canUseTool?.(tool, input, {
        signal: new AbortController().signal,
        toolUseID: 't',
      } as never) as Promise<PermissionResult>;
    expect(await decide('Agent', { subagent_type: 'security' })).toMatchObject({
      behavior: 'allow',
    });
    expect(await decide('Task', { subagent_type: 'security-deep' })).toMatchObject({
      behavior: 'allow',
    });
    expect(await decide('Agent', { subagent_type: 'general-purpose' })).toMatchObject({
      behavior: 'deny',
    });
    expect(await decide('Bash', { command: 'ls' })).toMatchObject({ behavior: 'deny' });
  });

  it('files a report under the chamber that made it, as the SDK names it, including the deeper pass', async () => {
    const replies: ToolReply[] = [];
    const { events, session } = run(async function* ({ call, next }) {
      await next();
      replies.push(
        await call('report', {
          input: { councillorId: 'tester', ...REPORT, bowOut: 'Nothing to test' },
          agent: 'tester',
        }),
      );
      replies.push(
        await call('report', {
          input: { councillorId: 'security', ...REPORT },
          agent: 'security-deep',
        }),
      );
      yield result;
    });
    await until(() => events.some((e) => e.type === 'reportFiled'));
    session.completeTool({ toolUseId: 'tu1', accepted: true });
    await until(() => events.filter((e) => e.type === 'reportFiled').length === 2);
    session.completeTool({ toolUseId: 'tu2', accepted: true });
    await until(() => replies.length === 2);
    expect(events.filter((e) => e.type === 'reportFiled')).toEqual([
      {
        type: 'reportFiled',
        toolUseId: 'tu1',
        councillorId: 'tester',
        report: { ...REPORT, bowOut: 'Nothing to test' },
      },
      { type: 'reportFiled', toolUseId: 'tu2', councillorId: 'security', report: REPORT },
    ]);
    expect(replies.map((r) => r.isError)).toEqual([undefined, undefined]);
  });

  it('files reports made at the same time under the right chambers, whatever order their handlers run in', async () => {
    const replies: ToolReply[] = [];
    const { events, session } = run(async function* ({ begin, next }) {
      await next();
      // Both chambers call report; the CLI runs the hooks, then the handlers in the other order.
      const tester = await begin('report', {
        input: { councillorId: 'tester', ...REPORT },
        agent: 'tester',
      });
      const security = await begin('report', {
        input: { councillorId: 'security', ...REPORT },
        agent: 'security',
      });
      const both = [security(), tester()];
      replies.push(...(await Promise.all(both)));
      yield result;
    });
    await until(() => events.filter((e) => e.type === 'reportFiled').length === 2);
    expect(
      events
        .filter((e) => e.type === 'reportFiled')
        .map((e) => e.type === 'reportFiled' && [e.toolUseId, e.councillorId]),
    ).toEqual([
      ['tu2', 'security'],
      ['tu1', 'tester'],
    ]);
    session.completeTool({ toolUseId: 'tu1', accepted: true });
    session.completeTool({ toolUseId: 'tu2', accepted: true });
    await until(() => replies.length === 2);
    expect(replies.map((r) => r.content[0]?.text)).toEqual([
      "Filed security's report.",
      "Filed tester's report.",
    ]);
  });

  it('turns down a report claiming another councillor, or filed by the elder itself, without telling core', async () => {
    const replies: ToolReply[] = [];
    const { events, session } = run(async function* ({ call, next }) {
      await next();
      replies.push(
        await call('report', { input: { councillorId: 'security', ...REPORT }, agent: 'tester' }),
      );
      replies.push(await call('report', { input: { councillorId: 'security', ...REPORT } }));
      // The queue of tool-use ids stays in step: the next good report gets its own id.
      replies.push(
        await call('report', { input: { councillorId: 'security', ...REPORT }, agent: 'security' }),
      );
      yield result;
    });
    await until(() => events.some((e) => e.type === 'reportFiled'));
    session.completeTool({ toolUseId: 'tu3', accepted: true });
    await until(() => replies.length === 3);
    expect(replies[0]).toEqual({
      content: [
        {
          type: 'text',
          text: "Not accepted: this is tester's chamber; file the report as tester.",
        },
      ],
      isError: true,
    });
    expect(replies[1]?.content[0]?.text).toBe(
      'Not accepted: councillors file their own reports from their chambers: dispatch security with the Agent tool.',
    );
    expect(replies[2]?.isError).toBeUndefined();
    expect(events.filter((e) => e.type === 'reportFiled')).toEqual([
      { type: 'reportFiled', toolUseId: 'tu3', councillorId: 'security', report: REPORT },
    ]);
  });

  it('asks the elder to re-consult only the affected chambers, dispatch added ones, and answer "Why?" from reports', async () => {
    const { session, inputs } = run(async function* ({ next }) {
      await next();
      await next();
      await next();
      await next();
      yield result;
    });
    await until(() => inputs.length === 1);
    session.message({ kind: 'changeRequested', version: 1, text: 'Add Google' });
    session.message({ kind: 'councillorAdded', councillorId: 'designer', effort: 'light' });
    session.message({
      kind: 'why',
      questionId: 'q3',
      councillorId: 'security',
      question: 'How long?',
      text: 'Why so short?',
    });
    await until(() => inputs.length === 4);
    expect(inputs[1]).toBe(
      'The user asked for changes to plan v1:\nAdd Google\n\nDispatch again only the councillors this change affects, with the change in your request; they report again. Then call propose_plan again.',
    );
    expect(inputs[2]).toBe(
      'The user added designer to the council at light effort. Dispatch it (subagent_type designer); it must report before the next plan.',
    );
    expect(inputs[3]).toContain(
      'The user asked security "Why?" about: "How long?" (questionId q3).\nThey added: Why so short?',
    );
    expect(inputs[3]).toContain(
      "if the report doesn't cover it, dispatch security again with the question first",
    );
  });

  it('briefs a chamber without a brief to read what its field needs', () => {
    expect(
      chamberPrompt({ councillorId: 'tester', guidance: 'G', brief: null, steps: 8 }),
    ).toContain('There is no research brief: read what your field needs, briefly.');
  });

  it('tells a chamber its steps, to report before running out, and to list folders with Glob', () => {
    // Seen live: a Tester chamber spent its steps reading (and tried to Read a folder) without reporting.
    const prompt = chamberPrompt({ councillorId: 'tester', guidance: 'G', brief: null, steps: 8 });
    expect(prompt).toContain('You have at most 8 steps (each tool call is one)');
    expect(prompt).toContain('Call the report tool by step 6 at the latest');
    expect(prompt).toContain("Read opens files only; to see what's in a folder, use Glob.");
    expect(
      chamberPrompt({ councillorId: 'tester', guidance: 'G', brief: null, steps: 1 }),
    ).toContain('by step 1');
  });

  it('opens without a brief and words a plain "Why?"', async () => {
    const { session, inputs } = run(
      async function* ({ next }) {
        await next();
        await next();
        yield result;
      },
      { brief: null },
    );
    await until(() => inputs.length === 1);
    expect(inputs[0]).toContain('There is no research brief: the councillors read what they need.');
    session.message({ kind: 'why', questionId: 'q1', councillorId: 'tester', question: 'Test?' });
    await until(() => inputs.length === 2);
    expect(inputs[1]).not.toContain('They added');
  });
});
