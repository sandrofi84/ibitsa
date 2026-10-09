import type {
  Options,
  PreToolUseHookInput,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  CouncilAnswer,
  CouncilEvent,
  CouncilQuestion,
  CouncilReport,
  PlanProposal,
  SittingMessage,
} from '@ibitsa/protocol';
import { briefMarkdown, type SittingSession } from '@ibitsa/runtime';
import { z } from 'zod';
import { loadSdk, userMessage } from './claude-session';
import { CouncillorSkills } from './councillor-skills';
import type { ToolReply } from './elder-session.types';
import { InputQueue } from './input-queue';
import type { AskedBatch, RoundTableInit, Seat, Verdict } from './round-table-session.types';

export const TOOL = (name: string) => `mcp__ibitsa__${name}`;
export const COUNCIL_TOOLS = ['report', 'ask_user', 'propose_plan', 'propose_amendment', 'say'].map(
  TOOL,
);
export const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** A sitting runs long: reports, questions, revisions. The cap usually ends it first. */
const MAX_TURNS = 120;

/** Appended to Claude Code's system prompt; the same for every round table, so it caches (spec §10). */
export const ROUND_TABLE_INSTRUCTIONS = `You are Ibitsa's council, sitting at a round table to plan a task with the user before anyone writes code. The elder chairs; the councillors you are given each speak for their own field. You only read: never edit files or run commands.

Work in this order:
1. For every councillor on the roster, think as that councillor (their guidance is in the first message) and call report once for them: their concerns (with severity and reason), questions for the user, recommendations, and what they didn't check. A councillor with nothing to add files a short bow-out saying why. Read code only where a councillor needs more than the brief.
2. Put the questions that matter to the user with ask_user, in one batch where you can: each names the councillor asking, offers options with their trade-offs, recommends one with a reason, and allows free text when the user might want something else. When ask_user accepts the batch, end your turn: the answers arrive as a message.
3. While you wait, the user may ask a councillor "Why?", or write to the council. Answer in that councillor's voice with say (others may add a line with say if their concern is affected), then end your turn again.
4. When every councillor has reported and the answers are in, call propose_plan: the goal, the tasks (each with the files likely touched, its dependencies, and acceptance criteria from the councillors who will review it), the islands and branching, and the Book of Decisions (every choice the user made, with the alternatives and the user's reason in their words). If it is accepted, end your turn: the user approves, asks for changes, or dismisses the council. On changes, consult again the councillors the change affects (they report again), then propose again.

Speak to the user only through say and ask_user; anything else you write is not shown. Keep reports and lines short. If a tool rejects a call, fix what it says and call it again. Only the user can end the sitting, with Dismiss the council in the council's pane: you can't. If the user asks you to stop, end or dismiss the council, tell them to use that button, and never say the council is dismissed.`;

const severity = z.enum(['low', 'medium', 'high', 'serious']);
const REPORT_SHAPE = {
  councillorId: z.string().describe('The councillor this report is for.'),
  concerns: z.array(z.object({ summary: z.string(), severity, reason: z.string() })),
  questions: z.array(z.string()).describe('Questions this councillor wants put to the user.'),
  recommendations: z.array(z.string()),
  notChecked: z.array(z.string()).describe("What this councillor didn't check, and why."),
  bowOut: z.string().optional().describe('Set when the councillor has nothing to add: why.'),
};
const ASK_SHAPE = {
  questions: z.array(
    z.object({
      councillorId: z.string(),
      question: z.string(),
      options: z.array(z.object({ id: z.string(), label: z.string(), tradeoff: z.string() })),
      recommendation: z.object({ optionId: z.string(), reason: z.string() }).optional(),
      allowFreeText: z.boolean(),
    }),
  ),
};
/** How the council splits a plan into worktrees (§5.3, #120); the same for both kinds of sitting. */
export const ISLANDS_RULE =
  'Group the tasks into islands, one branch and one hero each: tasks that build on each other share an island, in the order its hero works them; independent work goes on separate islands, which can run at the same time. Choose the branching: separate (every island branches from the base) or stacked (each island builds on the one listed before it, for work that layers).';

const PLAN_SHAPE = {
  summary: z.string().describe('The plan in a sentence or two.'),
  goal: z.string(),
  scope: z.string().optional().describe("What's in and out."),
  tasks: z
    .array(
      z.object({
        id: z.string().describe('T1, T2, …'),
        title: z.string(),
        description: z.string().describe('What the hero is told to do.'),
        files: z.array(z.string()).describe('Files likely touched.'),
        dependsOn: z.array(z.string()).describe('Task ids this one needs first.'),
        heroClass: z.enum(['paladin', 'barbarian', 'ranger', 'rogue']).optional(),
        criteria: z
          .array(z.object({ councillorId: z.string(), items: z.array(z.string()) }))
          .describe('Acceptance criteria per reviewing councillor on the roster.'),
        decisions: z.array(z.string()).describe('Decision ids this task depends on.'),
      }),
    )
    .describe('One hero works them in order, on one branch.'),
  decisions: z
    .array(
      z.object({
        id: z.string().describe('D1, D2, …'),
        title: z.string(),
        raisedBy: z.string().describe('The councillor who raised it, or "elder".'),
        chosen: z.string(),
        alternatives: z.array(z.object({ option: z.string(), rejectedBecause: z.string() })),
        tradeoffs: z.string().optional(),
        why: z.string().describe("The user's reason, in their words when they gave one."),
        discussion: z.string().optional().describe('2–3 lines; never a transcript.'),
        affects: z.array(z.string()).describe('Task ids.'),
        supersedes: z.string().optional(),
      }),
    )
    .describe('The Book of Decisions: every choice the user made.'),
  islands: z
    .array(
      z.object({
        id: z.string().describe('I1, I2, …'),
        title: z.string(),
        tasks: z.array(z.string()),
      }),
    )
    .describe(`${ISLANDS_RULE} Every task on exactly one island.`),
  branching: z.enum(['separate', 'stacked']),
};
/** A change to the approved plan mid-campaign (§4.8, #170); core checks it against what has started. */
const AMENDMENT_SHAPE = {
  summary: z.string().describe('What changes and why, in a sentence or two.'),
  tasks: PLAN_SHAPE.tasks.describe(
    'New tasks (new ids), and new versions of tasks not started yet (their own ids). Started tasks never change: rework is a new task.',
  ),
  removeTasks: z.array(z.string()).describe('Ids of tasks not started yet to drop.'),
  addToIslands: z
    .array(z.object({ islandId: z.string(), tasks: z.array(z.string()) }))
    .describe('New tasks added to the end of an existing island, in order.'),
  islands: PLAN_SHAPE.islands.describe(
    'New islands with their new tasks; each gets its own party.',
  ),
  decisions: PLAN_SHAPE.decisions.describe('New decisions for the Book of Decisions.'),
};
const SAY_SHAPE = {
  councillorId: z.string().describe('Who speaks: a councillor on the roster, or "elder".'),
  text: z.string(),
  questionId: z.string().optional().describe('The question this answers, for "Why?".'),
};

/**
 * A round table (spec §4.3, #103): one session voices every councillor. It reports, asks and proposes
 * through Ibitsa's tools; core rules on each call (roster, every councillor reported) and the verdict
 * goes back as the tool's result. What the user does later (answers, "Why?", changes) arrives as
 * messages, so the session stays open between turns.
 */
export class RoundTableSession implements SittingSession {
  protected readonly init: RoundTableInit;
  /** The streaming prompt: messages the session reads one by one, as the user acts. */
  private readonly input = new InputQueue<SDKUserMessage>();
  protected readonly seats: Seat[];
  /** Tool-use ids from the PreToolUse hook, per tool, waiting for their handler. */
  protected readonly toolUseIds = new Map<string, string[]>();
  private readonly verdicts = new Map<string, (verdict: Verdict) => void>();
  private readonly batches = new Map<string, AskedBatch>();
  /** Agent calls that started a chamber, and the councillor each one is for (#106). */
  private readonly startedChambers = new Map<string, string>();
  private readonly tokens = new Map<string, number>();
  /** Subagents and other tasks still running (#242): a chamber can outlive the elder's turn. */
  private readonly tasks = new Set<string>();
  private query: Query | null = null;
  private closed = false;
  private failed = false;

  constructor(init: RoundTableInit) {
    this.init = init;
    const skills = CouncillorSkills.of({ cwd: init.start.cwd, adapter: init.adapter });
    this.seats = init.start.roster.map(({ councillorId }) => seat({ skills, councillorId }));
    void this.run();
  }

  message(message: SittingMessage): void {
    this.input.push(userMessage({ text: this.wording(message), priority: 'next' }));
  }

  completeTool({
    toolUseId,
    accepted,
    reason,
  }: {
    toolUseId: string;
    accepted: boolean;
    reason?: string;
  }): void {
    const resolve = this.verdicts.get(toolUseId);
    this.verdicts.delete(toolUseId);
    resolve?.(reason === undefined ? { accepted } : { accepted, reason });
  }

  answer({ toolUseId, answers }: { toolUseId: string; answers: CouncilAnswer[] }): void {
    const batch = this.batches.get(toolUseId);
    if (!batch) return;
    this.batches.delete(toolUseId);
    this.input.push(userMessage({ text: answersText({ batch, answers }), priority: 'next' }));
  }

  close(): void {
    this.closed = true;
    for (const resolve of this.verdicts.values())
      resolve({ accepted: false, reason: 'The sitting has ended.' });
    this.verdicts.clear();
    this.input.end();
    this.query?.close();
  }

  // ---------- the tools ----------

  protected async report(
    input: { councillorId: string; bowOut?: string | undefined } & Omit<CouncilReport, 'bowOut'>,
    callId?: string,
  ): Promise<ToolReply> {
    const { councillorId, ...rest } = input;
    const report: CouncilReport = {
      concerns: rest.concerns,
      questions: rest.questions,
      recommendations: rest.recommendations,
      notChecked: rest.notChecked,
      ...(rest.bowOut ? { bowOut: rest.bowOut } : {}),
    };
    return this.ruled({
      tool: 'report',
      callId,
      event: (toolUseId) => ({ type: 'reportFiled', toolUseId, councillorId, report }),
      ok: `Filed ${councillorId}'s report.`,
    });
  }

  private async askUser(
    input: {
      questions: (Omit<CouncilQuestion, 'recommendation'> & {
        recommendation?: CouncilQuestion['recommendation'] | undefined;
      })[];
    },
    callId?: string,
  ): Promise<ToolReply> {
    const questions: CouncilQuestion[] = input.questions.map(({ recommendation, ...q }) =>
      recommendation ? { ...q, recommendation } : q,
    );
    return this.ruled({
      tool: 'ask_user',
      callId,
      event: (toolUseId) => {
        this.batches.set(toolUseId, { questions });
        return { type: 'questionsAsked', toolUseId, questions };
      },
      ok: 'The questions are with the user. End your turn now: their answers will arrive as a message.',
    });
  }

  /** The plan goes to core as sent (without empty optional fields); core checks it (`checkPlan`). */
  private async proposePlan(input: unknown, callId?: string): Promise<ToolReply> {
    const plan = JSON.parse(JSON.stringify(input)) as PlanProposal;
    return this.ruled({
      tool: 'propose_plan',
      callId,
      event: (toolUseId) => ({ type: 'planProposed', toolUseId, plan }),
      ok: 'The plan is with the user. End your turn: you will hear if they ask for changes.',
    });
  }

  private async proposeAmendment(input: unknown, callId?: string): Promise<ToolReply> {
    const amendment = JSON.parse(JSON.stringify(input)) as unknown;
    return this.ruled({
      tool: 'propose_amendment',
      callId,
      event: (toolUseId) => ({ type: 'amendmentProposed', toolUseId, amendment }),
      ok: 'The amendment is with the user. Say briefly why it helps, then end your turn.',
    });
  }

  private say({
    councillorId,
    text,
    questionId,
  }: {
    councillorId: string;
    text: string;
    questionId?: string | undefined;
  }): ToolReply {
    this.emit({
      type: 'said',
      councillorId,
      text,
      ...(questionId === undefined ? {} : { questionId }),
    });
    return reply('Said.');
  }

  /** Sends a tool call to core and returns its verdict to the model. */
  protected ruled({
    tool,
    callId,
    event,
    ok,
  }: {
    tool: string;
    /** The call's id from Claude Code's request metadata, when it sent one. */
    callId?: string | undefined;
    event: (toolUseId: string) => CouncilEvent;
    ok: string;
  }): Promise<ToolReply> {
    const toolUseId = this.claim({ tool, callId }) ?? `${tool}-${Date.now()}`;
    const verdict = new Promise<Verdict>((resolve) => this.verdicts.set(toolUseId, resolve));
    this.emit(event(toolUseId));
    return verdict.then(({ accepted, reason }) =>
      accepted
        ? reply(ok)
        : { ...reply(`Not accepted: ${reason ?? 'no reason given'}`), isError: true },
    );
  }

  /**
   * The tool-use id a handler serves: the one Claude Code names in the request's metadata, else the
   * oldest one the PreToolUse hook saw. Calls running at the same time (chambers reporting in parallel)
   * may reach their handlers in any order, so the metadata is what ties a call to its id.
   */
  protected claim({
    tool,
    callId,
  }: {
    tool: string;
    callId?: string | undefined;
  }): string | undefined {
    const queue = this.toolUseIds.get(TOOL(tool)) ?? [];
    if (callId === undefined) return queue.shift();
    const at = queue.indexOf(callId);
    if (at >= 0) queue.splice(at, 1);
    return callId;
  }

  // ---------- the session ----------

  private async run(): Promise<void> {
    try {
      const sdk = await (this.init.adapter.loadSdk ?? loadSdk)();
      const ibitsa = sdk.createSdkMcpServer({
        name: 'ibitsa',
        version: '1.0.0',
        tools: [
          sdk.tool(
            'report',
            "File one councillor's report.",
            REPORT_SHAPE,
            (i, extra) => this.report(i, callIdOf(extra)),
            {
              alwaysLoad: true,
            },
          ),
          sdk.tool(
            'ask_user',
            'Put a batch of questions to the user.',
            ASK_SHAPE,
            (i, extra) => this.askUser(i, callIdOf(extra)),
            { alwaysLoad: true },
          ),
          sdk.tool(
            'propose_plan',
            'Propose the plan to the user.',
            PLAN_SHAPE,
            (i, extra) => this.proposePlan(i, callIdOf(extra)),
            { alwaysLoad: true },
          ),
          sdk.tool(
            'propose_amendment',
            'Propose a change to the approved plan, once the heroes are at work.',
            AMENDMENT_SHAPE,
            (i, extra) => this.proposeAmendment(i, callIdOf(extra)),
            { alwaysLoad: true },
          ),
          sdk.tool(
            'say',
            'Say something to the user as a councillor or the elder.',
            SAY_SHAPE,
            async (i) => this.say(i),
            {
              alwaysLoad: true,
            },
          ),
        ],
      });
      const query = sdk.query({ prompt: this.input, options: this.options(ibitsa) });
      this.query = query;
      if (this.closed) query.close();
      // Resumed (#166, #169), the session already knows the task: it gets only the next message.
      const resume = this.init.start.resume;
      // A kept council (#167) starts a new sitting in its old session: it does get the opening.
      const first = resume && !resume.kept ? resume.prompt : this.opening();
      if (first) this.input.push(userMessage({ text: first, priority: 'next' }));
      for await (const message of query) this.onSdkMessage(message);
    } catch (error) {
      if (!this.closed)
        this.emit({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  /** The first message. Separate chambers words it for the chairing elder. */
  protected opening(): string {
    return openingText({ start: this.init.start, seats: this.seats });
  }

  /** What the user did, worded for the session. */
  protected wording(message: SittingMessage): string {
    return messageText({ message, seats: this.seats, skills: this.skills() });
  }

  protected options(ibitsa: NonNullable<Options['mcpServers']>[string]): Options {
    const { adapter, start } = this.init;
    const claudeCodePath = adapter.claudeCodePath?.()?.trim();
    return {
      cwd: start.cwd,
      model: start.model,
      env: adapter.env(),
      systemPrompt: { type: 'preset', preset: 'claude_code', append: ROUND_TABLE_INSTRUCTIONS },
      settingSources: ['project'],
      tools: READ_TOOLS,
      mcpServers: { ibitsa },
      allowedTools: [...READ_TOOLS, ...COUNCIL_TOOLS],
      canUseTool: async () => ({ behavior: 'deny', message: 'The council only reads the code.' }),
      hooks: {
        PreToolUse: [
          {
            hooks: [
              async (i) => {
                this.noteToolUse(i as PreToolUseHookInput);
                return {};
              },
            ],
          },
        ],
      },
      maxTurns: MAX_TURNS,
      maxBudgetUsd: start.maxBudgetMicroUsd / 1_000_000,
      // Resumed for a question (#169), or a council kept from the last campaign (#167).
      ...(start.resume ? { resume: start.resume.sessionId } : {}),
      ...(claudeCodePath ? { pathToClaudeCodeExecutable: claudeCodePath } : {}),
    };
  }

  /** Keeps a council tool call's id for its handler, which the SDK doesn't give one. */
  protected noteToolUse({ tool_name, tool_use_id }: PreToolUseHookInput): void {
    if (!COUNCIL_TOOLS.includes(tool_name)) return;
    this.toolUseIds.set(tool_name, [...(this.toolUseIds.get(tool_name) ?? []), tool_use_id]);
  }

  private onSdkMessage(m: SDKMessage): void {
    if (m.type === 'system' && m.subtype === 'init') {
      this.emit({ type: 'sessionStarted', sessionId: m.session_id });
      return;
    }
    if (m.type === 'assistant') {
      this.countTokens(m);
      return;
    }
    if (m.type === 'system') {
      this.noteTask(m);
      return;
    }
    if (m.type !== 'result') return;
    const byCouncillor = [...this.tokens].map(([councillorId, tokens]) => ({
      councillorId,
      tokens,
    }));
    this.emit({
      type: 'usage',
      totalCost: Math.round(m.total_cost_usd * 1_000_000),
      byModel: Object.entries(m.modelUsage ?? {}).map(([model, u]) => ({
        model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadInputTokens,
        cacheWriteTokens: u.cacheCreationInputTokens,
        costMicroUsd: Math.round(u.costUSD * 1_000_000),
      })),
      ...(byCouncillor.length > 0 ? { byCouncillor } : {}),
    });
    if (this.closed) return;
    if (m.subtype === 'success') {
      // The turn is over and no chamber is still at work: nothing moves until the user acts (#242).
      if (this.tasks.size === 0) this.emit({ type: 'idle' });
      return;
    }
    this.emit({
      type: 'error',
      message:
        m.subtype === 'error_max_budget_usd'
          ? 'The council ran out of gold. Its reports so far are kept.'
          : m.subtype === 'error_max_turns'
            ? 'The council took too many steps.'
            : `The sitting stopped: ${m.subtype.replaceAll('_', ' ')}.`,
    });
  }

  /** Keeps the set of running tasks: started and settled edges, or the SDK's full background set. */
  private noteTask(m: Extract<SDKMessage, { type: 'system' }>): void {
    if (m.subtype === 'task_started') this.tasks.add(m.task_id);
    else if (m.subtype === 'task_notification') this.tasks.delete(m.task_id);
    else if (m.subtype === 'background_tasks_changed') {
      this.tasks.clear();
      for (const t of m.tasks) if (!t.ambient) this.tasks.add(t.task_id);
    }
  }

  /**
   * Tokens per councillor (#106): a subagent's messages carry the id of the Agent call that started it,
   * and that call names the councillor. Only separate chambers has subagents.
   */
  private countTokens(m: Extract<SDKMessage, { type: 'assistant' }>): void {
    if (m.parent_tool_use_id === null) {
      for (const block of m.message.content) {
        if (block.type !== 'tool_use' || (block.name !== 'Agent' && block.name !== 'Task'))
          continue;
        const type = (block.input as { subagent_type?: unknown } | null)?.subagent_type;
        if (typeof type === 'string')
          this.startedChambers.set(block.id, type.replace(/-deep$/, ''));
      }
      return;
    }
    const councillorId = this.startedChambers.get(m.parent_tool_use_id);
    const usage = m.message.usage;
    if (!councillorId || !usage) return;
    const tokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0);
    this.tokens.set(councillorId, (this.tokens.get(councillorId) ?? 0) + tokens);
  }

  protected skills(): CouncillorSkills {
    return CouncillorSkills.of({ cwd: this.init.start.cwd, adapter: this.init.adapter });
  }

  protected emit(event: CouncilEvent): void {
    if (event.type === 'error') {
      if (this.failed) return;
      this.failed = true;
    }
    this.init.onEvent(event);
  }
}

/** The tool-use id Claude Code puts in an MCP call's request metadata (`claudecode/toolUseId`). */
export function callIdOf(extra: unknown): string | undefined {
  const meta = (extra as { _meta?: Record<string, unknown> } | null | undefined)?._meta;
  const id = meta?.['claudecode/toolUseId'];
  return typeof id === 'string' ? id : undefined;
}

export function reply(text: string): ToolReply {
  return { content: [{ type: 'text', text }] };
}

export function seat({
  skills,
  councillorId,
}: {
  skills: CouncillorSkills;
  councillorId: string;
}): Seat {
  const found = skills.planning(councillorId);
  return found
    ? { id: councillorId, title: found.info.title, guidance: found.guidance }
    : {
        id: councillorId,
        title: councillorId,
        guidance: '(No skill file found: plan from its name.)',
      };
}

/** The first message: the task, the brief, who sits and what each brings, and the budget. */
export function openingText({
  start,
  seats,
}: {
  start: RoundTableInit['start'];
  seats: Seat[];
}): string {
  const parts = [
    `Plan this task with the user.\n\nTask:\n${start.task}`,
    start.brief
      ? `The elder's research brief:\n\n${briefMarkdown(start.brief)}`
      : 'There is no research brief: read what you need.',
    `The roster (every one must report before you propose a plan):\n\n${seats
      .map((s) => `### ${s.id} (${s.title})\n\n${s.guidance}`)
      .join('\n\n')}`,
    `Your budget is $${(start.maxBudgetMicroUsd / 1_000_000).toFixed(2)}: keep reading and reports short.`,
  ];
  return parts.join('\n\n---\n\n');
}

/** What the user did, worded for the session. */
export function messageText({
  message,
  seats,
  skills,
}: {
  message: SittingMessage;
  seats: Seat[];
  skills: CouncillorSkills;
}): string {
  switch (message.kind) {
    case 'changeRequested':
      return `The user asked for changes to plan v${message.version}:\n${message.text}\n\nConsult again the councillors this change affects (they report again), then call propose_plan again.`;
    case 'councillorAdded': {
      const added = seat({ skills, councillorId: message.councillorId });
      seats.push(added);
      return `The user added ${added.id} (${added.title}) to the council. They must report before the next plan.\n\n${added.guidance}`;
    }
    case 'why': {
      const followUp =
        message.text && message.text !== 'Why?' ? `\nThey added: ${message.text}` : '';
      return `The user asked ${message.councillorId} "Why?" about: "${message.question}" (questionId ${message.questionId}).${followUp}\n\nAnswer in ${message.councillorId}'s voice with say, using that questionId. Others may add a line with say if their concern is affected. Then end your turn: the questions are still open.`;
    }
    case 'told':
      return toldText(message);
    case 'answered':
      return answeredText(message.answers);
  }
}

/** The user's own words to the council (#242), and what to do with them. */
export function toldText({ text, councillorId }: { text: string; councillorId?: string }): string {
  const to = councillorId ? ` to ${councillorId}` : '';
  const voice = councillorId ? `in ${councillorId}'s voice` : 'as whoever it concerns';
  return `The user says${to}:\n${text}\n\nAnswer with say, ${voice}. Then carry on with the sitting where this moves it: reports, questions with ask_user, or propose_plan. If the task can't go ahead, say why and end your turn: the user can tell you more, or end the sitting. Only the user can end the sitting, with Dismiss the council in the council's pane; if they ask you to, point them to it, and never say the council is dismissed.`;
}

/** Answers to questions asked before a reload (#166): the ask_user call they belonged to was lost. */
export function answeredText(answers: { question: string; answer: string }[]): string {
  const lines = answers.map((a) => `- ${a.question}\n  ${a.answer}`);
  return `VS Code reloaded while your questions were open. The user has answered them:\n\n${lines.join('\n')}\n\nCarry on with these answers.`;
}

/** The user's answers, each under its question. */
export function answersText({
  batch,
  answers,
}: {
  batch: AskedBatch;
  answers: CouncilAnswer[];
}): string {
  const lines = batch.questions.map((q, i) => {
    const answer = answers[i];
    const said =
      answer === undefined
        ? '(no answer)'
        : 'optionId' in answer
          ? (q.options.find((o) => o.id === answer.optionId)?.label ?? answer.optionId)
          : `In their words: ${answer.text}`;
    return `- ${q.councillorId} asked "${q.question}": ${said}`;
  });
  return `The user answered:\n${lines.join('\n')}\n\nCarry on: when every councillor has reported, propose the plan.`;
}
