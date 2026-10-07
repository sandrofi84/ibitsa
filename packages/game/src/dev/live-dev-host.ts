import {
  type CoreInput,
  type CoreState,
  type Effect,
  initialState,
  Journal,
  type LogRecord,
  step,
  view,
} from '@ibitsa/core';
import {
  type AgentEvent,
  type Command,
  type CoreMessage,
  type CouncilEvent,
  type CouncillorInfo,
  type ElderEvent,
  type HostEvent,
  type HostRequest,
  type Plan,
  PROTOCOL_VERSION,
  type RepoView,
} from '@ibitsa/protocol';
import type { Host } from '../host.types';
import { MemoryViewStorage } from '../view-state';
import { DevActions, devPreview } from './dev-actions';
import { DEMO_FILES, FakeHostChannel } from './fake-host-channel';

const STEP_MS = 120;
/** How much slower a chambers sitting's reports arrive than other scripted steps. */
const CHAMBER_PACE = 6;

/**
 * Standalone `live` mode (#37): the real core, answered by a scripted fake runtime instead of a replay,
 * so the UI can be played end to end (forms, messages, stop, finish) without an agent.
 */
export class LiveDevHost implements Host {
  readonly viewStorage = new MemoryViewStorage();
  private readonly devActions = new DevActions();
  readonly channel: FakeHostChannel;
  private state: CoreState = initialState();
  private readonly journal = new Journal();
  /** "Always allow in this project" rules, kept for the page's lifetime (#62). */
  private projectRules: string[] = [];
  private seq = 0;
  private readonly started = Date.now();
  private readonly listeners: ((m: CoreMessage) => void)[] = [];
  private readonly repo: RepoView | null;
  private diffs = 0;
  /** The scripted sitting's first councillor: it asks, and reviews the plan's tasks. */
  private asker = 'tester';

  /** False acts like native Windows, where hero commands run without a sandbox (#63). */
  private readonly sandboxed: boolean;

  constructor({
    credentialsReady,
    repo,
    sandboxed = true,
  }: {
    credentialsReady: boolean;
    repo: RepoView | null;
    sandboxed?: boolean;
  }) {
    this.channel = new FakeHostChannel({ credentialsReady });
    this.repo = repo;
    this.sandboxed = sandboxed;
  }

  onMessage(listener: (m: CoreMessage) => void): void {
    this.listeners.push(listener);
  }

  request(request: HostRequest): void {
    this.channel.request(request);
  }

  onHostEvent(listener: (event: HostEvent) => void): void {
    this.channel.onHostEvent(listener);
  }

  send(command: Command): void {
    if (command.type === 'forgetProjectRule') {
      this.projectRules = this.projectRules.filter((r) => r !== command.rule);
      this.emitSnapshot();
      return;
    }
    if (command.type === 'requestFiles') {
      this.emit({ type: 'files', seq: ++this.seq, islandId: command.islandId, paths: DEMO_FILES });
      return;
    }
    if (command.type === 'requestPreview') {
      this.emit({ type: 'preview', seq: ++this.seq, preview: devPreview(command) });
      return;
    }
    if (command.type === 'requestActions') {
      this.emit({ type: 'actions', seq: ++this.seq, actions: this.devActions.list });
      return;
    }
    if (command.type === 'createAction') {
      const { type: _type, overwrite = false, ...draft } = command;
      for (const reply of this.devActions.create({ draft, overwrite })) {
        this.emit({ ...reply, seq: ++this.seq });
      }
      return;
    }
    if (command.type === 'requestJournal') {
      const page = this.journal.page({ before: command.before, limit: command.limit });
      this.emit({ type: 'journal', seq: ++this.seq, ...page });
      return;
    }
    if (command.type === 'hello') {
      this.emit({ type: 'welcome', seq: ++this.seq, protocolVersion: PROTOCOL_VERSION });
      this.emitSnapshot();
      return;
    }
    this.input({ kind: 'command', t: this.t(), command });
  }

  private t(): number {
    return Date.now() - this.started;
  }

  private input(input: CoreInput): void {
    const result = step(this.state, input);
    this.state = result.state;
    for (const cue of result.cues) this.emit({ type: 'cue', seq: ++this.seq, cue });
    const lines = this.journal.add({ record: input as LogRecord, state: this.state });
    if (lines.length > 0) {
      const start = this.journal.entries.length - lines.length;
      this.emit({ type: 'journalAppend', seq: ++this.seq, entries: lines, start });
    }
    this.emitSnapshot();
    for (const effect of result.effects) this.perform(effect);
  }

  /** A chambers sitting: councillors study a while before each report arrives. */
  private slowly(sittingId: string, events: CouncilEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'council', t: this.t(), sittingId, event }),
        STEP_MS * CHAMBER_PACE * (i + 1),
      );
    });
  }

  private council(sittingId: string, events: CouncilEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'council', t: this.t(), sittingId, event }),
        STEP_MS * (i + 1),
      );
    });
  }

  private elder(elderId: string, events: ElderEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'elder', t: this.t(), elderId, event }),
        STEP_MS * (i + 1),
      );
    });
  }

  private agent(heroId: string, events: AgentEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'agent', t: this.t(), heroId, event }),
        STEP_MS * (i + 1),
      );
    });
  }

  /** A short scripted turn: read, edit, a reply, then waiting for orders. */
  private turn(reply: string): AgentEvent[] {
    const id = `u${++this.diffs}`;
    return [
      { type: 'activityStarted', toolUseId: `${id}r`, kind: 'read', detail: 'src/app.ts' },
      { type: 'activityFinished', toolUseId: `${id}r`, outcome: 'ok' },
      { type: 'activityStarted', toolUseId: `${id}e`, kind: 'edit', detail: 'src/app.ts' },
      { type: 'activityFinished', toolUseId: `${id}e`, outcome: 'ok' },
      { type: 'message', text: reply },
      {
        type: 'usage',
        contextUsed: 20_000 + 5_000 * this.diffs,
        contextMax: 200_000,
        totalCost: 15_000 * this.diffs,
      },
      { type: 'turnEnded', queuedTurns: 0 },
    ];
  }

  private submission(): AgentEvent[] {
    return [
      { type: 'taskSubmitted', toolUseId: `s${++this.diffs}`, summary: 'Ready for review.' },
      { type: 'turnEnded', queuedTurns: 0 },
    ];
  }

  private perform(effect: Effect): void {
    switch (effect.type) {
      case 'createWorktree':
        setTimeout(
          () =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: {
                type: 'worktreeCreated',
                islandId: effect.islandId,
                path: `/demo.ibitsa/${effect.branch}`,
                branch: effect.branch,
              },
            }),
          STEP_MS,
        );
        return;
      case 'startSitting': {
        const [first] = effect.roster;
        this.asker = first?.councillorId ?? 'tester';
        // In separate chambers the reports come in one by one, so the study stage can be watched (#105).
        const play = (events: CouncilEvent[]) =>
          effect.mode === 'chambers'
            ? this.slowly(effect.sittingId, events)
            : this.council(effect.sittingId, events);
        play([
          { type: 'sessionStarted', sessionId: 'live-sitting' },
          ...effect.roster.map(
            (c, i): CouncilEvent => ({
              type: 'reportFiled',
              toolUseId: `rep${i}`,
              councillorId: c.councillorId,
              report: {
                concerns: [],
                questions: [],
                recommendations: ['Keep it small.'],
                notChecked: [],
              },
            }),
          ),
          {
            type: 'questionsAsked',
            toolUseId: 'ask1',
            questions: [
              {
                councillorId: first?.councillorId ?? 'tester',
                question: 'Should the change come with a test?',
                options: [
                  { id: 'yes', label: 'Yes', tradeoff: 'A little slower; safer' },
                  { id: 'no', label: 'No', tradeoff: 'Faster; nothing guards it' },
                ],
                recommendation: { optionId: 'yes', reason: 'It is cheap here.' },
                allowFreeText: true,
              },
            ],
          },
          { type: 'usage', totalCost: 180_000 },
        ]);
        return;
      }
      case 'sittingMessage':
        if (effect.message.kind === 'why') {
          this.council(effect.sittingId, [
            {
              type: 'said',
              councillorId: effect.message.councillorId,
              text: 'Because nothing else checks this code.',
              questionId: effect.message.questionId,
            },
          ]);
        } else if (effect.message.kind === 'changeRequested') {
          this.council(effect.sittingId, [
            {
              type: 'planProposed',
              toolUseId: `plan${++this.diffs}`,
              plan: livePlan({
                summary: `Revised: ${effect.message.text}`,
                councillorId: this.asker,
              }),
            },
          ]);
        }
        return;
      case 'answerSittingQuestions':
        this.council(effect.sittingId, [
          {
            type: 'planProposed',
            toolUseId: 'plan0',
            plan: livePlan({
              summary: 'Two tasks: make the change, then cover it with a test.',
              councillorId: this.asker,
            }),
          },
          { type: 'usage', totalCost: 260_000 },
        ]);
        return;
      case 'startElder':
        this.elder(effect.elderId, elderScript(effect.task));
        return;
      case 'startSession':
      case 'resumeSession':
        this.agent(effect.heroId, [
          { type: 'sessionStarted', sessionId: 'live-session' },
          ...this.turn('I looked around and made a first change. What next?'),
        ]);
        return;
      case 'sendMessage':
        // Asking it to submit hands the task in, so the Finish flow can be played too (a planned quest's next
        // task says to commit and submit, and is handed in straight away); asking it only to
        // commit asks your permission first, offering "Always allow" (#62).
        if (/commit/i.test(effect.text) && !/submit/i.test(effect.text)) {
          this.agent(effect.heroId, [
            { type: 'turnStarted' },
            {
              type: 'permission',
              requestId: `p${++this.diffs}`,
              tool: 'Bash',
              input: { command: 'git commit -m "demo"' },
              alwaysAllow: ['Bash(git commit:*)'],
            },
          ]);
          return;
        }
        this.agent(effect.heroId, [
          { type: 'turnStarted' },
          ...(/submit/i.test(effect.text) ? this.submission() : this.turn(`Done: ${effect.text}`)),
        ]);
        return;
      case 'answerPermission':
        if (effect.always === 'project' && effect.rules) {
          this.projectRules = [...new Set([...this.projectRules, ...effect.rules])];
        }
        this.agent(
          effect.heroId,
          this.turn(effect.decision === 'allow' ? 'Committed.' : 'Skipped.'),
        );
        return;
      case 'interrupt':
        this.agent(effect.heroId, [{ type: 'turnEnded', queuedTurns: 0 }]);
        return;
      case 'compactSession':
        // Rest (#82): the session compacts, freeing most of its context.
        this.agent(effect.heroId, [
          { type: 'turnStarted' },
          { type: 'resting' },
          { type: 'compacted', trigger: 'manual', preTokens: 40_000, postTokens: 6_000 },
          { type: 'usage', contextUsed: 6_000, contextMax: 200_000 },
          { type: 'turnEnded', queuedTurns: 0 },
        ]);
        return;
      case 'observeDiff':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: { type: 'diffObserved', heroId: effect.heroId, hash: `h${this.diffs}` },
        });
        return;
      case 'checkSubmit':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: {
            type: 'submitChecked',
            heroId: effect.heroId,
            toolUseId: effect.toolUseId,
            ok: true,
          },
        });
        return;
      case 'removeWorktree':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: { type: 'worktreeRemoved', islandId: effect.islandId },
        });
        return;
      default:
        // Timers, answers, submit verdicts and session closing need no scripted reply here.
        return;
    }
  }

  private emitSnapshot(): void {
    this.emit({
      type: 'snapshot',
      seq: ++this.seq,
      snapshot: {
        ...view(this.state),
        repo: this.repo,
        projectRules: this.projectRules,
        sandboxed: this.sandboxed,
        councillors: LIVE_COUNCILLORS,
        councilMode: 'ask',
      },
    });
  }

  private emit(message: CoreMessage): void {
    queueMicrotask(() => {
      for (const l of this.listeners) l(message);
    });
  }
}

/**
 * A scripted elder (#101): a moment of reading, then a brief recommending a quick quest. A task that
 * mentions "fail" runs out of gold instead, so the failure path can be played too.
 */
function elderScript(task: string): ElderEvent[] {
  const reading: ElderEvent[] = [
    { type: 'sessionStarted', sessionId: 'live-elder' },
    { type: 'activity', text: 'Reading README.md' },
    { type: 'activity', text: 'Searching for login' },
    { type: 'usage', totalCost: 31_000 },
  ];
  if (/fail/i.test(task)) {
    return [
      ...reading,
      { type: 'error', message: 'The elder ran out of gold before finishing the brief.' },
    ];
  }
  return [
    ...reading,
    {
      type: 'briefSubmitted',
      brief: {
        task: task.split('\n')[0] ?? task,
        files: [
          { path: 'README.md', note: 'what the project says about itself' },
          { path: 'src/app.ts', lines: '1-40', note: 'where the change goes' },
        ],
        findings: ['Tests run with Vitest.', 'Nothing else depends on this code.'],
        slices: [{ councillorId: 'tester', summary: 'One behaviour to cover', pointers: [] }],
        councillors: [{ councillorId: 'tester', reason: 'The change needs a test.' }],
        effort: { level: 'light', reason: 'A small change.' },
        councillorEfforts: [{ councillorId: 'tester', level: 'light', reason: 'One case.' }],
        quickQuest: { recommended: true, reason: 'One small, clear change.' },
      },
    },
    { type: 'usage', totalCost: 42_000 },
  ];
}

/** The built-in roster, as the runtime would list it from Ibitsa's plugin (#98). */
const LIVE_COUNCILLORS: CouncillorInfo[] = [
  ['architect', 'Architect', 'Structure and boundaries'],
  ['tester', 'Tester', 'Tests and behaviour'],
  ['security', 'Security', 'Trust boundaries'],
].map(([id = '', title = '', description = '']) => ({
  id,
  skill: `ibitsa:${id}`,
  title,
  description,
  source: 'builtin',
  portrait: null,
  model: null,
  tools: ['Read', 'Grep', 'Glob'],
  modes: { planning: true, review: true },
  hash: id,
}));

/**
 * A small valid plan (#104, #123): two tasks on two islands, the second waiting on the first, and a
 * decision raised by the asking councillor. Separate, unless the summary asks for a stack.
 */
function livePlan({ summary, councillorId }: { summary: string; councillorId: string }): Plan {
  return {
    summary,
    goal: 'Fix the login redirect so it no longer loops.',
    tasks: [
      {
        id: 'T1',
        title: 'Fix the redirect',
        description: 'Stop the login redirect from looping.',
        files: ['src/app.ts'],
        dependsOn: [],
        criteria: [{ councillorId, items: ['Signing in lands on the page you asked for.'] }],
        decisions: ['D1'],
      },
      {
        id: 'T2',
        title: 'Cover it with a test',
        description: 'Add a test for the redirect.',
        files: ['src/app.test.ts'],
        dependsOn: ['T1'],
        criteria: [{ councillorId, items: ['The test fails without the fix.'] }],
        decisions: ['D1'],
      },
    ],
    islands: [
      { id: 'I1', title: 'The redirect fix', tasks: ['T1'] },
      { id: 'I2', title: 'The redirect test', tasks: ['T2'] },
    ],
    branching: /stack/i.test(summary) ? 'stacked' : 'separate',
    decisions: [
      {
        id: 'D1',
        title: 'Test the fix',
        raisedBy: councillorId,
        chosen: 'Yes',
        alternatives: [{ option: 'No', rejectedBecause: 'Nothing would guard it.' }],
        why: 'It is cheap here.',
        affects: ['T1', 'T2'],
      },
    ],
  };
}
