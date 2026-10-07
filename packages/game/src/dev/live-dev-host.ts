import {
  type CoreInput,
  type CoreState,
  DEFAULT_SETTINGS,
  type Effect,
  initialState,
  Journal,
  type LogRecord,
  type QuestSettings,
  Sitting,
  step,
  view,
} from '@ibitsa/core';
import {
  type AgentEvent,
  type ChronicleEntry,
  type Command,
  type CoreMessage,
  type CouncilEvent,
  type CouncillorInfo,
  type ElderEvent,
  type Finding,
  type GitHostView,
  type HostEvent,
  type HostRequest,
  type LessonsEvent,
  type Plan,
  PROTOCOL_VERSION,
  type RepoView,
  type ReviewEvent,
} from '@ibitsa/protocol';
import type { Host } from '../host.types';
import { MemoryViewStorage } from '../view-state';
import { DemoReview } from './demo-review';
import { DevActions, devPreview } from './dev-actions';
import { FakeGitHub } from './fake-github';
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
  private readonly gitHost: GitHostView | undefined;
  private readonly keptCouncil: { from: string } | null;
  private diffs = 0;
  /** Every command the game sent, oldest first. */
  readonly sent: Command[] = [];
  /** The scripted sitting's first councillor: it asks, and reviews the plan's tasks. */
  private asker = 'tester';

  /** False acts like native Windows, where hero commands run without a sandbox (#63). */
  private readonly sandboxed: boolean;

  /** Dev only (#125): this many heroes start on their own islands at the first hello. */
  private readonly heroes: number;
  /** True while that campaign is set up, so its council isn't also played by the script. */
  private settingUp = false;
  /** Dev only (#140): paced checks and verdicts for watching councillors walk out (`review=demo`). */
  private readonly demoReview: DemoReview | null;
  /** Dev only (#153): pushes and PRs answered as GitHub would; polls on a timer with `pr=demo`. */
  private readonly github: FakeGitHub;
  /** The settings every dev campaign starts from: the defaults plus the page's params. */
  private readonly settings: QuestSettings;
  /** Task points whose "failing check" already failed once (#141). */
  private readonly checksFailed = new Set<string>();
  /** How many reviews each task's round has started, so the first can be the one that asks (#141). */
  private readonly reviewsStarted = new Map<string, number>();

  constructor({
    credentialsReady,
    repo,
    sandboxed = true,
    campaignBudgetUsd,
    heroes = 0,
    review,
    reviews = false,
    pullRequestPollMs = null,
    gitHost,
    keptCouncil = null,
  }: {
    credentialsReady: boolean;
    repo: RepoView | null;
    sandboxed?: boolean;
    /** A campaign cap, as `ibitsa.campaign.budgetUsd` would set it (#126). */
    campaignBudgetUsd?: number;
    heroes?: number;
    /** Dev only (#140): `demo` turns reviews on and answers them with a paced scripted verdict. */
    review?: 'demo';
    /** Reviews on (#141): submitted tasks are checked and reviewed by scripted councillors. */
    reviews?: boolean;
    /** Dev only (#153): how often the fake GitHub polls watched PRs; null polls only on Refresh. */
    pullRequestPollMs?: number | null;
    /** Dev only (#162): what the git host allows, as the runtime would report it. */
    gitHost?: GitHostView;
    /** Dev only (#168): a council kept from an earlier campaign; the elder then finds the task unrelated. */
    keptCouncil?: { from: string } | null;
  }) {
    this.channel = new FakeHostChannel({ credentialsReady });
    // A class or recolor changed in the Armory (#182): the snapshot carries it, as the runtime's does.
    this.channel.armory.onChange(() => this.emitSnapshot());
    this.repo = repo;
    this.gitHost = gitHost;
    this.keptCouncil = keptCouncil;
    this.sandboxed = sandboxed;
    this.demoReview =
      review === 'demo'
        ? new DemoReview({ input: (input) => this.input(input), t: () => this.t() })
        : null;
    this.github = new FakeGitHub({
      input: (input) => this.input(input),
      t: () => this.t(),
      pollMs: pullRequestPollMs,
    });
    this.settings = {
      ...DEFAULT_SETTINGS,
      reviews: reviews || this.demoReview !== null,
      ...(campaignBudgetUsd === undefined
        ? {}
        : { campaignBudgetMicroUsd: Math.round(campaignBudgetUsd * 1_000_000) }),
    };
    if (campaignBudgetUsd !== undefined || this.settings.reviews) {
      this.state = step(this.state, {
        kind: 'gm',
        t: 0,
        event: { type: 'questSettings', ...this.settings },
      }).state;
    }
    this.heroes = heroes;
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
    // Kept for tests that check what the game sent (#139).
    this.sent.push(command);
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
      this.emit({
        type: 'preview',
        seq: ++this.seq,
        preview: devPreview(command),
        ...(command.heroId ? { heroId: command.heroId } : {}),
      });
      return;
    }
    if (command.type === 'requestActions') {
      this.emit({
        type: 'actions',
        seq: ++this.seq,
        actions: this.devActions.list,
        ...(command.heroId ? { heroId: command.heroId } : {}),
      });
      return;
    }
    if (command.type === 'createAction') {
      const { type: _type, overwrite = false, ...draft } = command;
      for (const reply of this.devActions.create({ draft, overwrite })) {
        this.emit({ ...reply, seq: ++this.seq });
      }
      return;
    }
    if (command.type === 'requestChronicle') {
      this.emit({ type: 'chronicle', seq: ++this.seq, campaigns: LIVE_CHRONICLE });
      return;
    }
    if (command.type === 'requestJournal') {
      const page = this.journal.page({ before: command.before, limit: command.limit });
      this.emit({ type: 'journal', seq: ++this.seq, ...page });
      return;
    }
    if (command.type === 'hello') {
      this.emit({ type: 'welcome', seq: ++this.seq, protocolVersion: PROTOCOL_VERSION });
      if (this.heroes > 1 && !this.state.campaign) this.startParties(this.heroes);
      this.emitSnapshot();
      return;
    }
    this.input({ kind: 'command', t: this.t(), command });
  }

  /**
   * Dev only (#125): a campaign with `count` heroes on their own islands, as if the council had planned
   * it and party assembly started it, so several heroes can be played before those screens exist.
   */
  private startParties(count: number): void {
    const names = PARTY_NAMES.slice(0, count);
    this.settingUp = true;
    this.input({
      kind: 'gm',
      t: this.t(),
      event: { type: 'questSettings', ...this.settings, maxParallel: count },
    });
    this.input({
      kind: 'command',
      t: this.t(),
      command: {
        type: 'conveneCouncil',
        commandId: 'dev-1',
        task: 'Fix the login redirect',
        mode: 'roundTable',
        roster: ['tester'],
        effort: 'light',
      },
    });
    const sittingId = this.state.sitting?.id ?? '';
    const tasks = names.map((_, i) => ({
      id: `T${i + 1}`,
      title: `Part ${i + 1}`,
      description: `Do part ${i + 1} of the fix.`,
      files: [],
      dependsOn: [],
      criteria: [],
      decisions: [],
    }));
    for (const event of [
      {
        type: 'reportFiled' as const,
        toolUseId: 'dev-r',
        councillorId: 'tester',
        report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
      },
      {
        type: 'planProposed' as const,
        toolUseId: 'dev-p',
        plan: {
          summary: `${count} parties fix the login redirect.`,
          goal: 'Fix the login redirect.',
          tasks,
          decisions: [],
          islands: tasks.map((t, i) => ({
            id: `I${i + 1}`,
            title: `Island ${i + 1}`,
            tasks: [t.id],
          })),
          branching: 'separate' as const,
        },
      },
    ]) {
      this.input({ kind: 'council', t: this.t(), sittingId, event });
    }
    this.input({
      kind: 'command',
      t: this.t(),
      command: { type: 'approvePlan', commandId: 'dev-2', version: 1 },
    });
    this.settingUp = false;
    this.input({
      kind: 'command',
      t: this.t(),
      command: {
        type: 'startCampaign',
        commandId: 'dev-3',
        baseRef: 'main',
        parties: names.map(([heroName, classId], i) => ({
          islandId: `I${i + 1}`,
          heroName,
          classId,
        })),
      },
    });
  }

  private t(): number {
    return Date.now() - this.started;
  }

  /** Dev only (#166): as if VS Code reloaded, the core hears the old sessions are gone. */
  reload(): void {
    this.input({ kind: 'gm', t: this.t(), event: { type: 'runtimeRestarted' } });
  }

  /**
   * Straight into a campaign of three islands (#124), for seeing the map without the elder or council.
   * Two parties work at once, so the third island waits.
   */
  demoCampaign(branching: 'separate' | 'stacked'): void {
    this.approvedCampaign({
      settings: { ...this.settings, maxParallel: 2 },
      // With the demo reviews on (#140), three councillors set criteria, so three walk out to each task.
      plan: demoPlan({
        branching,
        reviewers: this.demoReview ? ['security', 'tester', 'architect'] : [],
      }),
      parties: [
        { islandId: 'I1', heroName: 'Ranger Ilse', classId: 'ranger' },
        { islandId: 'I2', heroName: 'Rogue Vex', classId: 'rogue' },
        { islandId: 'I3', heroName: 'Paladin Aric', classId: 'paladin' },
      ],
    });
  }

  /**
   * Dev only (#141): straight into a one-task campaign with reviews on, for playing the review loop
   * without the elder or council. The scenario picks the script: `pass` (changes once, then a pass),
   * `stubborn` (changes until the loop limit of 2), `revisit` (a suggestion asks to revisit D1),
   * `dispute` (the hero disputes the findings), `failing` (a check fails once) or `broken` (a reviewer
   * can't finish).
   */
  scriptedReviews(scenario: string): void {
    this.approvedCampaign({
      settings: {
        ...this.settings,
        reviews: true,
        maxParallel: 1,
        loopLimit: scenario === 'stubborn' ? 2 : DEFAULT_SETTINGS.loopLimit,
      },
      plan: reviewPlan(REVIEW_TITLES[scenario] ?? 'Fix the redirect'),
      parties: [{ islandId: 'I1', heroName: 'Ranger Ilse', classId: 'ranger' }],
    });
  }

  /**
   * Dev only (#153): straight into a one-island campaign of two tasks, no reviews, for playing a PR from
   * draft to merged (`pr=demo`). Tell the hero to submit to clear each task. `stacked` (#154, `pr=stacked`):
   * two stacked islands of one task each, for merging the first and restacking the second.
   */
  pullRequestDemo(layout: 'one' | 'stacked' = 'one'): void {
    this.approvedCampaign({
      settings: { ...this.settings, maxParallel: 2 },
      plan: layout === 'stacked' ? stackedPullRequestPlan() : pullRequestPlan(),
      parties: [
        { islandId: 'I1', heroName: 'Ranger Ilse', classId: 'ranger' },
        ...(layout === 'stacked'
          ? [{ islandId: 'I2', heroName: 'Rogue Vex', classId: 'rogue' }]
          : []),
      ],
    });
  }

  /**
   * An approved plan stepped into core without carrying out its effects (no scripted sitting), then the
   * campaign started for real.
   */
  private approvedCampaign({
    settings,
    plan,
    parties,
  }: {
    settings: QuestSettings;
    plan: Plan;
    parties: { islandId: string; heroName: string; classId: string }[];
  }): void {
    const quietly = (input: CoreInput) => {
      this.state = step(this.state, input).state;
    };
    const t = this.t();
    // Every councillor with criteria sits, as the plan's criteria must come from the roster.
    const criteria = plan.tasks.flatMap((task) => task.criteria.map((c) => c.councillorId));
    const roster = [...new Set(['tester', ...criteria])];
    quietly({ kind: 'gm', t, event: { type: 'questSettings', ...settings } });
    const command = (c: Record<string, unknown>) =>
      quietly({
        kind: 'command',
        t,
        command: { commandId: `demo-${++this.diffs}`, ...c } as Command,
      });
    command({
      type: 'conveneCouncil',
      task: plan.goal,
      mode: 'roundTable',
      roster,
      effort: 'light',
    });
    const sittingId = this.state.sitting?.id ?? '';
    const council = (event: CouncilEvent) => quietly({ kind: 'council', t, sittingId, event });
    // A lead session: to ask mid-campaign (#169), and a context to keep or empty at the end (#167).
    council({ type: 'sessionStarted', sessionId: 'live-sitting' });
    for (const councillorId of roster) {
      council({
        type: 'reportFiled',
        toolUseId: `demo-report-${councillorId}`,
        councillorId,
        report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
      });
    }
    council({ type: 'planProposed', toolUseId: 'demo-plan', plan });
    command({ type: 'approvePlan', version: 1 });
    this.input({
      kind: 'command',
      t,
      command: {
        type: 'startCampaign',
        commandId: `demo-${++this.diffs}`,
        baseRef: 'main',
        parties,
      },
    });
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

  private reviewer(reviewId: string, events: ReviewEvent[]): void {
    events.forEach((event, i) => {
      setTimeout(
        () => this.input({ kind: 'review', t: this.t(), reviewId, event }),
        STEP_MS * (i + 1),
      );
    });
  }

  /** The task point a hero is on, from core's state. */
  private taskOf(heroId: string) {
    const hero = this.state.heroes.find((h) => h.id === heroId);
    return this.taskPoint(hero?.taskPointId ?? '');
  }

  private taskPoint(taskPointId: string) {
    return this.state.islands.flatMap((i) => i.taskPoints).find((tp) => tp.id === taskPointId);
  }

  private submission(): AgentEvent[] {
    return [
      { type: 'taskSubmitted', toolUseId: `s${++this.diffs}`, summary: 'Ready for review.' },
      { type: 'turnEnded', queuedTurns: 0 },
    ];
  }

  private perform(effect: Effect): void {
    if (this.demoReview?.perform(effect)) return;
    if (this.github.perform(effect)) return;
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
        if (this.settingUp) return;
        if (effect.resume) {
          // Asked to amend the plan (#170): the elder proposes a task and an island, then the turn ends.
          const plan = Sitting.approvedPlan(this.state);
          // The user's words, not the instructions (which name propose_amendment to every question).
          if (plan && /amend the plan|changes to Amendment \d+/i.test(effect.resume.prompt ?? '')) {
            this.council(effect.sittingId, [
              { type: 'amendmentProposed', toolUseId: 'amend', amendment: demoAmendment(plan) },
              {
                type: 'said',
                councillorId: 'elder',
                text: 'Docs belong with the work: a task here, and an island for the site.',
              },
              { type: 'usage', totalCost: 40_000 },
            ]);
            return;
          }
          // Asked mid-campaign (#169): the councillor asked answers, else the elder, then the turn ends.
          // At a chamber's pace, so "The council is thinking…" shows as it would for a real one.
          const asked = effect.resume.prompt?.match(/The user asks (\S+), who answers/)?.[1];
          this.slowly(effect.sittingId, [
            {
              type: 'said',
              councillorId: asked ?? 'elder',
              text: asked
                ? `${asked} here: nothing in the work so far changes my advice.`
                : 'The campaign is on track; nothing needs the council yet.',
            },
            { type: 'usage', totalCost: 40_000 },
          ]);
          return;
        }
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
        this.elder(effect.elderId, elderScript({ task: effect.task, kept: this.keptCouncil }));
        return;
      case 'startSession':
      case 'resumeSession':
        this.agent(effect.heroId, [
          { type: 'sessionStarted', sessionId: 'live-session' },
          ...this.turn('I looked around and made a first change. What next?'),
        ]);
        return;
      case 'sendMessage': {
        // Sent back on a "dispute" task (#141), the hero disputes the open findings instead of fixing them.
        const task = this.taskOf(effect.heroId);
        if (/dispute_finding/.test(effect.text) && /dispute/i.test(task?.title ?? '')) {
          const latest = new Map<string, { id: string; changes: boolean }>();
          for (const r of task?.review?.reviews ?? []) {
            if (r.status === 'done')
              latest.set(r.councillorId, { id: r.id, changes: r.verdict?.verdict === 'changes' });
          }
          this.agent(effect.heroId, [
            { type: 'turnStarted' },
            {
              type: 'findingDisputed',
              reviewIds: [...latest.values()].filter((r) => r.changes).map((r) => r.id),
              reason: 'The finding asks for what decision D1 settled.',
            },
            { type: 'turnEnded', queuedTurns: 0 },
          ]);
          return;
        }
        // Told a check failed (#141), it fixes it and waits for orders rather than handing it straight
        // back, so the failure can be read in the task panel; asking it to submit hands it in again.
        if (/^The check `/.test(effect.text)) {
          this.agent(effect.heroId, [
            { type: 'turnStarted' },
            ...this.turn('I fixed the failing test. Tell me to submit when you are ready.'),
          ]);
          return;
        }
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
          // Once the user settles a dispute (#141), it hands the task in again.
          ...(/submit|disputed findings/i.test(effect.text)
            ? this.submission()
            : this.turn(`Done: ${effect.text}`)),
        ]);
        return;
      }
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
            head: `head-${++this.diffs}`,
          },
        });
        return;
      case 'runChecks': {
        // A "failing check" task fails its tests once, so the fix-and-resubmit path can be played (#141).
        const failing =
          /failing check/i.test(this.taskPoint(effect.taskPointId)?.title ?? '') &&
          !this.checksFailed.has(effect.taskPointId);
        if (failing) this.checksFailed.add(effect.taskPointId);
        setTimeout(
          () =>
            this.input({
              kind: 'gm',
              t: this.t(),
              event: {
                type: 'checksRan',
                taskPointId: effect.taskPointId,
                results: scriptedChecks(failing),
              },
            }),
          STEP_MS,
        );
        return;
      }
      case 'startReview': {
        const key = `${effect.taskPointId}:${effect.round}`;
        const started = this.reviewsStarted.get(key) ?? 0;
        this.reviewsStarted.set(key, started + 1);
        this.reviewer(effect.reviewId, scriptedReview({ effect, first: started === 0 }));
        return;
      }
      // The end of a campaign (#167): scripted lessons, and the record "written".
      case 'startLessons':
        setTimeout(() => {
          const lessons = (event: LessonsEvent) =>
            this.input({ kind: 'lessons', t: this.t(), lessonsId: effect.lessonsId, event });
          lessons({
            type: 'lessonsSubmitted',
            lessons: ['Brief the hero on what the reviewers check.'],
          });
          lessons({ type: 'usage', totalCost: 20_000 });
        }, STEP_MS);
        return;
      case 'writeRecord':
        this.input({
          kind: 'gm',
          t: this.t(),
          event: { type: 'recordWritten', path: '.ibitsa/campaigns/demo/record.md' },
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
        ...(this.gitHost ? { gitHost: this.gitHost } : {}),
        keptCouncil: this.keptCouncil,
        classes: this.channel.armory.classes(),
        recolor: this.channel.armory.recolor(),
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
function elderScript({
  task,
  kept,
}: {
  task: string;
  kept: { from: string } | null;
}): ElderEvent[] {
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
        // With a kept council (#168): a past campaign that bears on it, and the kept work unrelated.
        ...(kept
          ? {
              relatedCampaigns: [
                { campaignId: 'c-slugs', title: 'Slugs', why: 'It touched the same router.' },
              ],
              keptContext: { related: false, reason: `"${kept.from}" was about payments.` },
            }
          : {}),
      },
    },
    { type: 'usage', totalCost: 42_000 },
  ];
}

/** Two past campaigns for the Guild Hall's Chronicle (#179). */
const LIVE_CHRONICLE: ChronicleEntry[] = [
  {
    campaignId: 'c-slugs',
    title: 'Slugs without accents',
    date: '2026-10-05',
    status: 'finished',
    summary: 'Make slugify strip accents.',
    path: '.ibitsa/campaigns/c-slugs/record.md',
    pullRequests: [{ number: 12, url: 'https://github.com/ibitsa/demo/pull/12', state: 'merged' }],
    gold: 1_240_000,
  },
  {
    campaignId: 'c-payments',
    title: 'Payments',
    date: '2026-09-28',
    status: 'abandoned',
    summary: null,
    path: '.ibitsa/campaigns/c-payments/record.md',
    pullRequests: [],
    gold: null,
  },
];

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
  // Where the extension would find its skill, for the Roster's Customise (#181).
  path: `/ibitsa/plugin/skills/${id}/SKILL.md`,
}));

/** Three islands with a task each (#124): separate, or stacked in this order. */
function demoPlan({
  branching,
  reviewers,
}: {
  branching: 'separate' | 'stacked';
  /** Councillors with a criterion for every task, who review them (#140). */
  reviewers: string[];
}): Plan {
  const task = (id: string, title: string) => ({
    id,
    title,
    description: `${title}.`,
    files: [],
    dependsOn: [],
    criteria: reviewers.map((councillorId) => ({ councillorId, items: [`${title} works.`] })),
    decisions: [],
  });
  return {
    summary: 'Sign-in in three parts.',
    goal: 'Ship sign-in.',
    tasks: [task('T1', 'Add the schema'), task('T2', 'Add the API'), task('T3', 'Add the form')],
    decisions: [],
    islands: [
      { id: 'I1', title: 'Schema', tasks: ['T1'] },
      { id: 'I2', title: 'API', tasks: ['T2'] },
      { id: 'I3', title: 'Form', tasks: ['T3'] },
    ],
    branching,
  };
}

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

/** Each review scenario's task title (#141): the keyword in it picks the script. */
const REVIEW_TITLES: Record<string, string> = {
  stubborn: 'Fix the redirect (stubborn review)',
  revisit: 'Fix the redirect (revisit)',
  dispute: 'Fix the redirect (dispute)',
  failing: 'Fix the redirect (failing check)',
  broken: 'Fix the redirect (broken reviewer)',
};

/** One task on one island (#141), with criteria for two councillors and a decision on it. */
/** The PR demo's plan (#153): one island, two tasks, a decision, so the PR body has something in it. */
/**
 * Dev only (#170): the scripted council's amendment: a docs task at the end of the plan's first island,
 * and a new island for a docs site.
 */
function demoAmendment(plan: Plan): unknown {
  const ids = plan.tasks.map((t) => Number(t.id.slice(1)));
  const next = Math.max(0, ...ids) + 1;
  const islands = plan.islands ?? [
    { id: 'I1', title: plan.goal, tasks: plan.tasks.map((t) => t.id) },
  ];
  const islandNext = Math.max(0, ...islands.map((i) => Number(i.id.slice(1)))) + 1;
  const task = (n: number, title: string) => ({
    id: `T${n}`,
    title,
    description: `${title}.`,
    files: ['README.md'],
    dependsOn: [],
    criteria: [],
    decisions: [],
  });
  return {
    summary: 'Document the work: a docs task here, and a docs site on its own island.',
    tasks: [task(next, 'Document the slugs'), task(next + 1, 'Build the docs site')],
    removeTasks: [],
    addToIslands: [{ islandId: islands[0]?.id ?? 'I1', tasks: [`T${next}`] }],
    islands: [{ id: `I${islandNext}`, title: 'Docs site', tasks: [`T${next + 1}`] }],
    decisions: [],
  };
}

function pullRequestPlan(): Plan {
  const task = (id: string, title: string) => ({
    id,
    title,
    description: `${title}.`,
    files: ['src/slug.ts'],
    dependsOn: [],
    criteria: [],
    decisions: ['D1'],
  });
  return {
    summary: 'Slugs without accents.',
    goal: 'Make slugify strip accents.',
    tasks: [task('T1', 'Strip accents in slugify'), task('T2', 'Test the accented slugs')],
    islands: [{ id: 'I1', title: 'Accent-free slugs', tasks: ['T1', 'T2'] }],
    branching: 'separate',
    decisions: [
      {
        id: 'D1',
        title: 'How to strip',
        raisedBy: 'tester',
        chosen: 'Unicode normalisation',
        alternatives: [{ option: 'A lookup table', rejectedBecause: 'It misses letters.' }],
        why: 'It covers every accent.',
        affects: ['T1', 'T2'],
      },
    ],
  };
}

/** Two stacked islands of one task each (#154): the second builds on the first's branch. */
function stackedPullRequestPlan(): Plan {
  const plan = pullRequestPlan();
  return {
    ...plan,
    islands: [
      { id: 'I1', title: 'Accent-free slugs', tasks: ['T1'] },
      { id: 'I2', title: 'Accent tests', tasks: ['T2'] },
    ],
    branching: 'stacked',
  };
}

function reviewPlan(title: string): Plan {
  return {
    summary: 'One task, reviewed by the tester and security.',
    goal: 'Fix the login redirect so it no longer loops.',
    tasks: [
      {
        id: 'T1',
        title,
        description: 'Stop the login redirect from looping.',
        files: ['src/app.ts'],
        dependsOn: [],
        criteria: [
          { councillorId: 'tester', items: ['Signing in lands on the page you asked for.'] },
          { councillorId: 'security', items: ['It never redirects off the site.'] },
        ],
        decisions: ['D1'],
      },
    ],
    islands: [{ id: 'I1', title: 'The redirect fix', tasks: ['T1'] }],
    branching: 'separate',
    decisions: [
      {
        id: 'D1',
        title: 'Test the fix',
        raisedBy: 'tester',
        chosen: 'Yes',
        alternatives: [{ option: 'No', rejectedBecause: 'Nothing would guard it.' }],
        why: 'It is cheap here.',
        affects: ['T1'],
      },
    ],
  };
}

/** The scripted checks (#141): tests and lint, the tests failing when asked to. */
export function scriptedChecks(failing: boolean) {
  return [
    {
      command: 'pnpm test',
      ok: !failing,
      output: failing
        ? 'FAIL src/app.test.ts > redirects after sign-in\nExpected "/settings", got "/"\n\n1 failed, 11 passed'
        : '12 passed',
    },
    { command: 'pnpm lint', ok: true, output: 'No problems.' },
  ];
}

/**
 * A scripted reviewer (#141). The first reviewer of round 1 asks for changes (a blocking finding on its
 * first criterion) and leaves a suggestion; everyone else, and every later round, passes. A "stubborn"
 * task's first reviewer asks every round, a "revisit" task's suggestion asks to revisit a decision, and a
 * "broken reviewer" task's first reviewer can't finish.
 */
export function scriptedReview({
  effect,
  first,
}: {
  effect: Extract<Effect, { type: 'startReview' }>;
  first: boolean;
}): ReviewEvent[] {
  const text = effect.task.title;
  const opening: ReviewEvent[] = [
    { type: 'sessionStarted', sessionId: `live-${effect.reviewId}` },
    { type: 'usage', totalCost: 40_000 },
  ];
  if (first && /broken reviewer/i.test(text)) {
    return [
      ...opening,
      { type: 'error', message: 'The reviewer ran out of gold before finishing.' },
    ];
  }
  const findings: Finding[] = [];
  if (first && (effect.round === 1 || /stubborn/i.test(text))) {
    const [criterion] = effect.criteria;
    findings.push({
      severity: 'blocking',
      ...(criterion ? { criterion } : { kind: 'bug' as const }),
      file: 'src/app.ts',
      line: 12,
      message: 'Signing in still lands on the home page.',
    });
  }
  if (first && effect.round === 1) {
    findings.push({
      severity: 'suggestion',
      file: 'src/app.ts',
      message: 'Name the redirect helper after what it guards.',
    });
    const [decision] = effect.decisions;
    if (/revisit/i.test(text) && decision) {
      findings.push({
        severity: 'suggestion',
        message: 'A test may cost more than it saves here.',
        revisit: decision.id,
      });
    }
  }
  const blocking = findings.some((f) => f.severity === 'blocking');
  return [
    ...opening,
    {
      type: 'verdictSubmitted',
      toolUseId: `v-${effect.reviewId}`,
      verdict: { verdict: blocking ? 'changes' : 'pass', findings },
    },
  ];
}

/** The dev campaign's heroes (#125): a name and a class each. */
const PARTY_NAMES: [string, string][] = [
  ['Ranger Ilse', 'ranger'],
  ['Rogue Vex', 'rogue'],
  ['Paladin Ada', 'paladin'],
  ['Barbarian Bo', 'barbarian'],
];
