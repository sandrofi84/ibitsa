import type { AgentEvent, ExecutionState, HeroView } from '@ibitsa/protocol';
import { Campaign } from './campaign';
import type { NewHero } from './hero.types';
import { describePermission } from './needs-you';
import { Review } from './review';
import type { HeroRecord, QuestSettings, StallWatch } from './state.types';
import type { StepContext } from './step.types';

/** No events for this long, with no tool running mid-turn, means core has lost contact (§5.4). */
export const SILENCE_MS = 5 * 60_000;
/** What a hero is told when it should pick its work back up. */
export const CONTINUE_PROMPT = 'Continue with the task.';
/** What a hero who was working hears when its session resumes after a reload (#166). */
export const RESTART_PROMPT = 'VS Code reloaded; carry on where you left off.';

/**
 * A hero's rules: execution state, activity, the stall watch, the gold pouch, pausing and resuming
 * (spec §5.4, §7.3, §10). Wraps a plain `HeroRecord` for the length of one step (ADR 0002).
 */
export class Hero {
  readonly record: HeroRecord;
  private readonly ctx: StepContext;

  constructor({ record, ctx }: { record: HeroRecord; ctx: StepContext }) {
    this.record = record;
    this.ctx = ctx;
  }

  static silenceTimer(heroId: string): string {
    return `silence:${heroId}`;
  }

  static create({ hero, settings }: { hero: NewHero; settings: QuestSettings }): HeroRecord {
    return {
      ...hero,
      sessionStarted: false,
      inTurn: false,
      runningTools: [],
      lastMessage: null,
      allowRules: [],
      heldFor: [],
      campaignCapped: false,
      resting: false,
      pendingSubmit: null,
      submitted: null,
      unknownReason: null,
      error: null,
      outOfGold: false,
      hp: { kind: 'unknown' },
      gold: { kind: 'unknown' },
      queuedMessages: 0,
      sessionId: null,
      sessionLive: true,
      stalled: null,
      cap:
        settings.budgetMicroUsd === null || settings.budget === 'none'
          ? null
          : { microUsd: settings.budgetMicroUsd, enforcement: settings.budget },
      watch: Hero.freshWatch(),
    };
  }

  static freshWatch(): StallWatch {
    return {
      failingTest: null,
      editsSincePass: {},
      passedThisTurn: false,
      lastDiff: null,
      quietTurns: 0,
    };
  }

  get id(): string {
    return this.record.id;
  }

  // ---------- what the game sees ----------

  /** Exactly one state, highest precedence first (§5.4). */
  executionState(): ExecutionState {
    const r = this.record;
    if (r.unknownReason !== null) return { kind: 'unknown', reason: r.unknownReason };
    if (r.error !== null) return { kind: 'error', message: r.error };
    if (r.outOfGold) return { kind: 'outOfGold' };
    if (r.stalled !== null) return { kind: 'stalled', reason: r.stalled };
    if (this.ctx.needsYou.isAsking(r.id)) return { kind: 'waitingOnYou' };
    if (r.resting) return { kind: 'resting' };
    if (r.inTurn || r.runningTools.length > 0) return { kind: 'working' };
    if (this.task()?.state === 'underReview') return { kind: 'underReview' };
    const island = this.island();
    if (island && !island.launched) {
      return { kind: 'blocked', reason: Campaign.blockReason(this.ctx.state, island) };
    }
    if (r.heldFor.length > 0) return { kind: 'blocked', reason: 'dependency' };
    if (r.submitted) return { kind: 'submitted', summary: r.submitted.summary };
    if (r.sessionStarted) return { kind: 'idle' };
    return { kind: 'traveling' };
  }

  view(): HeroView {
    const r = this.record;
    const state = this.executionState();
    const tool = r.runningTools.at(-1);
    const activity =
      state.kind !== 'working'
        ? null
        : tool
          ? { kind: tool.kind, ...(tool.detail === undefined ? {} : { detail: tool.detail }) }
          : { kind: 'think' as const };
    return {
      id: r.id,
      name: r.name,
      classId: r.classId,
      islandId: r.islandId,
      taskPointId: r.taskPointId,
      state,
      activity,
      hp: r.hp,
      gold: r.gold,
      queuedMessages: r.queuedMessages,
    };
  }

  // ---------- commands ----------

  sendMessage({
    commandId,
    text,
    priority,
  }: {
    commandId: string;
    text: string;
    priority: 'now' | 'next';
  }): void {
    const r = this.record;
    if (!r.sessionStarted) {
      this.ctx.outbox.reject(commandId, 'The hero has not arrived yet.');
      return;
    }
    if (r.outOfGold) {
      this.ctx.outbox.reject(commandId, 'The hero is out of gold. Raise the cap first.');
      return;
    }
    // Answering a stall with a message is one of its choices (spec §10 item 11).
    if (r.stalled !== null) this.clearStall();
    this.ctx.needsYou.removeFor(r.id, ['reply']);
    this.continueWith({ text, priority });
  }

  stop(): void {
    const r = this.record;
    r.queuedMessages = 0;
    if (r.stalled !== null) this.clearStall();
    if (r.error !== null) {
      r.error = null;
      this.ctx.needsYou.removeFor(r.id, ['error']);
    }
    if (r.outOfGold) {
      r.outOfGold = false;
      this.ctx.needsYou.removeFor(r.id, ['outOfGold']);
    }
    if (r.sessionLive) this.ctx.outbox.effect({ type: 'interrupt', heroId: r.id });
    // Until the interrupted turn ends, a reload mustn't take it for work in progress (#166).
    if (r.inTurn) r.stopping = true;
    this.watchSilence();
  }

  /** Rest (§6.3, #82): compact the live session to free context; the hero keeps its task. */
  rest(commandId: string): void {
    const r = this.record;
    if (this.ctx.state.campaign?.status !== 'active') {
      this.ctx.outbox.reject(commandId, 'There is no quest running.');
      return;
    }
    if (!r.sessionLive) {
      this.ctx.outbox.reject(commandId, 'The hero has no session to rest.');
      return;
    }
    if (r.resting) {
      this.ctx.outbox.reject(commandId, 'The hero is already resting.');
      return;
    }
    this.ctx.outbox.effect({ type: 'compactSession', heroId: r.id });
  }

  resume(commandId: string): void {
    const r = this.record;
    if (r.stalled !== null) {
      this.clearStall();
      this.continueWith({ text: CONTINUE_PROMPT, priority: 'next' });
      return;
    }
    if (r.error !== null || r.unknownReason !== null || !r.sessionLive) {
      const wasWorking = r.unknownReason !== null || r.error !== null;
      r.error = null;
      r.unknownReason = null;
      this.ctx.needsYou.removeFor(r.id, ['error']);
      this.revive(wasWorking && !r.submitted ? CONTINUE_PROMPT : undefined);
      return;
    }
    this.ctx.outbox.reject(commandId, 'Nothing to resume.');
  }

  raiseCap({ commandId, addMicroUsd }: { commandId: string; addMicroUsd: number }): void {
    const r = this.record;
    if (!r.cap) {
      this.ctx.outbox.reject(commandId, 'This hero has no gold pouch.');
      return;
    }
    r.cap = { ...r.cap, microUsd: r.cap.microUsd + addMicroUsd };
    if (r.outOfGold && !this.overBudget()) {
      r.outOfGold = false;
      this.ctx.needsYou.removeFor(r.id, ['outOfGold']);
      if (r.cap.enforcement === 'native') this.revive(CONTINUE_PROMPT);
      else this.continueWith({ text: CONTINUE_PROMPT, priority: 'next' });
    }
  }

  markDone(commandId: string): void {
    if (this.record.inTurn) {
      this.ctx.outbox.reject(commandId, 'The hero is still working.');
      return;
    }
    this.submit({ summary: '', head: null });
  }

  // ---------- game master results ----------

  worktreeCreated(path: string): void {
    this.ctx.outbox.effect({
      type: 'startSession',
      heroId: this.id,
      cwd: path,
      classId: this.record.classId,
      prompt: this.prompt(),
      ...this.remainder(),
    });
    this.watchSilence();
  }

  worktreeFailed(message: string): void {
    this.fail(`Could not create the worktree: ${message}`);
    this.watchSilence();
  }

  submitChecked({
    toolUseId,
    ok,
    reason,
    head,
  }: {
    toolUseId: string;
    ok: boolean;
    reason?: string;
    head?: string;
  }): void {
    const r = this.record;
    if (r.pendingSubmit?.toolUseId !== toolUseId) return;
    const { summary } = r.pendingSubmit;
    r.pendingSubmit = null;
    if (ok) this.submit({ summary, head: head ?? null });
    this.ctx.outbox.effect({
      type: 'completeSubmit',
      heroId: r.id,
      toolUseId,
      accepted: ok,
      ...(ok ? {} : { reason: reason ?? 'The submit check failed.' }),
    });
  }

  /** The no-progress stall rule, after each turn (spec §10 item 11). */
  diffObserved(hash: string): void {
    const w = this.record.watch;
    const quiet = w.lastDiff === hash && !w.passedThisTurn;
    w.quietTurns = quiet ? w.quietTurns + 1 : 0;
    w.lastDiff = hash;
    w.passedThisTurn = false;
    if (w.quietTurns >= this.limits().noProgressTurns)
      this.stall(`No progress for ${w.quietTurns} turns.`);
  }

  /**
   * PR comments (#154): back to the island's last task, told what to change. Its next submit is checked
   * and reviewed again; a session that ended resumes.
   */
  reopen(text: string): void {
    const r = this.record;
    const task = this.task();
    if (!task) return;
    task.state = 'active';
    if (task.review) Review.reopen(task.review);
    r.submitted = null;
    this.continueWith({ text, priority: 'next' });
  }

  /** A message from the game master (#154), reviving a session that ended. */
  tell(text: string): void {
    this.continueWith({ text, priority: 'next' });
  }

  /**
   * Its island's PR is ready for review (§5.6): the session closes. A message later (PR comments,
   * #154) resumes it by its id, like any hero whose session isn't live.
   */
  endSession(): void {
    const r = this.record;
    if (!r.sessionLive) return;
    r.sessionLive = false;
    r.inTurn = false;
    r.runningTools = [];
    this.ctx.outbox.effect({ type: 'closeSession', heroId: r.id });
    this.ctx.outbox.effect({ type: 'cancelTimer', timerId: Hero.silenceTimer(r.id) });
  }

  /**
   * The agent process is gone (spec §12). A hero who was working resumes its session and carries on
   * (#166), as does one whose worktree was still being made; any other hero resumes with its next
   * message. Returns whether it resumed now.
   */
  restarted(): boolean {
    const r = this.record;
    const island = this.island();
    const wasWorking = r.inTurn && !r.stopping;
    r.stopping = false;
    // Its worktree was being created: that result is lost, so it's asked for again.
    const traveling = island?.launched === true && !island.worktreePath && !island.worktreeRemoved;
    r.sessionLive = false;
    r.inTurn = false;
    r.runningTools = [];
    r.resting = false;
    r.pendingSubmit = null;
    this.ctx.outbox.effect({ type: 'cancelTimer', timerId: Hero.silenceTimer(r.id) });
    if (r.error !== null || r.outOfGold || r.stalled !== null) return false;
    if (!wasWorking && !(traveling && r.sessionId === null)) return false;
    if (r.sessionId) {
      this.revive(RESTART_PROMPT);
      // It works on that prompt straight away, as a new session works on its first.
      r.inTurn = true;
    } else this.revive();
    this.watchSilence();
    return true;
  }

  // ---------- agent events ----------

  handle(event: AgentEvent): void {
    const r = this.record;
    r.unknownReason = null; // any event proves contact
    switch (event.type) {
      case 'sessionStarted':
        r.sessionStarted = true;
        r.sessionLive = true;
        r.sessionId = event.sessionId;
        r.inTurn = true; // the session starts by working on its prompt
        break;
      case 'turnStarted':
        r.inTurn = true;
        r.queuedMessages = 0;
        this.ctx.needsYou.removeFor(r.id, ['reply']);
        break;
      case 'turnEnded':
        r.stopping = false;
        this.turnEnded(event.queuedTurns);
        break;
      case 'activityStarted':
        r.inTurn = true;
        r.runningTools.push({
          toolUseId: event.toolUseId,
          kind: event.kind,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
        break;
      case 'activityFinished':
        this.activityFinished({ toolUseId: event.toolUseId, ok: event.outcome === 'ok' });
        break;
      case 'message':
        r.lastMessage = event.text;
        this.ctx.outbox.cue({ type: 'heroSaid', heroId: r.id, text: event.text });
        break;
      case 'permission':
        // Auto mode answers at once, except across a hard limit, which always asks (#63).
        if (this.ctx.state.campaign?.autoApprove && !event.boundary) {
          this.ctx.outbox.effect({
            type: 'answerPermission',
            heroId: r.id,
            requestId: event.requestId,
            decision: 'allow',
          });
          break;
        }
        this.ctx.needsYou.ask({
          kind: 'permission',
          heroId: r.id,
          requestId: event.requestId,
          ...describePermission(event.tool, event.input),
          cwd: this.worktreePath() ?? '(unknown)',
          alwaysAllow: event.alwaysAllow ?? [],
        });
        break;
      case 'question':
        this.ctx.needsYou.ask({
          kind: 'question',
          heroId: r.id,
          requestId: event.requestId,
          questions: event.questions,
        });
        break;
      case 'usage':
        if (event.contextUsed !== undefined && event.contextMax !== undefined) {
          r.hp = { kind: 'exact', value: { used: event.contextUsed, max: event.contextMax } };
        }
        if (event.totalCost !== undefined) {
          // An agent that reports tokens but no cost gets an estimate from its prices (§11.5).
          r.gold =
            event.costBasis === undefined
              ? { kind: 'exact', value: event.totalCost }
              : { kind: 'estimated', value: event.totalCost, basis: event.costBasis };
          // Without a native cap, core enforces the pouch at each usage report (may overshoot a turn).
          if (r.cap?.enforcement === 'turnEnd' && this.overBudget() && !r.outOfGold) {
            this.ctx.outbox.effect({ type: 'interrupt', heroId: r.id });
            this.outOfGold();
          }
        }
        break;
      case 'resting':
        r.resting = true;
        break;
      case 'compacted':
        r.resting = false;
        if (event.postTokens !== undefined && r.hp.kind !== 'unknown') {
          r.hp = { kind: 'exact', value: { used: event.postTokens, max: r.hp.value.max } };
        }
        break;
      case 'findingDisputed':
        new Review(this.ctx).disputed({ hero: r, event });
        break;
      case 'taskSubmitted':
        r.pendingSubmit = { toolUseId: event.toolUseId, summary: event.summary };
        this.ctx.outbox.effect({ type: 'checkSubmit', heroId: r.id, toolUseId: event.toolUseId });
        break;
      case 'budgetExhausted':
        this.outOfGold();
        break;
      case 'retrying':
        this.ctx.outbox.cue({ type: 'retrying', heroId: r.id, reason: event.reason });
        break;
      case 'error':
        this.fail(event.message);
        break;
    }
    this.watchSilence();
  }

  /** The silence timer fired. */
  lostContact(): void {
    const minutes = Math.round(SILENCE_MS / 60_000);
    this.record.unknownReason = this.record.sessionStarted
      ? `No events for ${minutes} min.`
      : `The session has not started after ${minutes} min.`;
  }

  /**
   * A task handed in. In a planned quest the hero moves on to the next task, told as a message on the
   * same session (spec §14.2); after the last one, the hero is submitted.
   */
  /** A task handed in: checked and reviewed first when the campaign reviews (M5), else done at once. */
  submit({ summary, head }: { summary: string; head: string | null }): void {
    this.ctx.needsYou.removeFor(this.id, ['reply']);
    if (this.ctx.state.settings.reviews)
      new Review(this.ctx).begin({ hero: this.record, summary, head });
    else this.taskDone({ summary, state: 'doneUnreviewed' });
  }

  /**
   * A task finished: done (passed review) or, without reviews, done unreviewed. In a planned quest the
   * hero moves on to the next task, told as a message on the same session (spec §14.2); after the last,
   * the hero is submitted.
   */
  taskDone({ summary, state }: { summary: string; state: 'done' | 'doneUnreviewed' }): void {
    const task = this.task();
    if (task) task.state = state;
    const next = this.island()?.taskPoints.find((tp) => tp.state === 'locked');
    if (!next) {
      this.record.submitted = { summary };
      return;
    }
    this.record.taskPointId = next.id;
    // A task that waits on another island's task is held until that one is done (#121).
    const unmet = Campaign.unmet({ state: this.ctx.state, taskPoint: next });
    if (unmet.length > 0) this.record.heldFor = unmet;
    else this.takeNextTask();
  }

  /** The current task, now that nothing holds it: active on the map and sent to the hero. */
  takeNextTask(): void {
    this.record.heldFor = [];
    const task = this.task();
    if (task) task.state = 'active';
    // Its session ended (a ready PR, a reload): the task resumes it (#170).
    if (!this.record.sessionLive) {
      this.revive(this.prompt());
      this.watchSilence();
      return;
    }
    this.ctx.outbox.effect({
      type: 'sendMessage',
      heroId: this.id,
      text: this.prompt(),
      priority: 'next',
    });
  }

  /** The campaign's cap is reached (§14.3, #121): stop and ask, like an empty pouch. */
  stopForCampaign(cap: number): void {
    const r = this.record;
    r.campaignCapped = true;
    r.outOfGold = true;
    if (r.inTurn) this.ctx.outbox.effect({ type: 'interrupt', heroId: r.id });
    r.inTurn = false;
    r.runningTools = [];
    this.ctx.needsYou.ask({
      kind: 'outOfGold',
      heroId: r.id,
      cap,
      capEnforcement: 'turnEnd',
      scope: 'campaign',
    });
  }

  /** The campaign's cap was raised past what's spent: carry on. */
  releaseCampaignCap(): void {
    const r = this.record;
    r.campaignCapped = false;
    if (this.overBudget()) return;
    r.outOfGold = false;
    this.ctx.needsYou.removeFor(r.id, ['outOfGold']);
    this.continueWith({ text: CONTINUE_PROMPT, priority: 'next' });
  }

  /** Arm the silence timer while a turn is in progress with no tool running; disarm otherwise. */
  watchSilence(): void {
    const r = this.record;
    const expectingEvents =
      this.island()?.launched !== false &&
      (!r.sessionStarted || (r.inTurn && r.runningTools.length === 0)) &&
      r.sessionLive &&
      !this.ctx.needsYou.isAsking(r.id) &&
      !r.resting &&
      r.error === null &&
      r.stalled === null &&
      !r.outOfGold;
    this.ctx.outbox.effect(
      expectingEvents
        ? { type: 'setTimer', timerId: Hero.silenceTimer(r.id), at: this.ctx.t + SILENCE_MS }
        : { type: 'cancelTimer', timerId: Hero.silenceTimer(r.id) },
    );
  }

  // ---------- internals ----------

  private turnEnded(queuedTurns: number): void {
    const r = this.record;
    r.runningTools = [];
    const worktreePath = this.worktreePath();
    if (worktreePath) this.ctx.outbox.effect({ type: 'observeDiff', heroId: r.id, worktreePath });
    if (queuedTurns > 0) return;
    r.inTurn = false;
    r.queuedMessages = 0;
    this.followBase(worktreePath);
    if (r.cap?.enforcement === 'native' && this.overBudget()) this.outOfGold();
    const paused = r.stalled !== null || r.outOfGold || r.error !== null;
    // A task under review (M5) isn't waiting for orders: the review sends it back or passes it.
    const reviewing = this.task()?.state === 'underReview';
    if (!r.submitted && !paused && !reviewing) {
      this.ctx.needsYou.ask({ kind: 'reply', heroId: r.id, text: r.lastMessage ?? '' });
    }
  }

  /** Stacked, all at once (#121): between turns, catch up with the island this one builds on. */
  private followBase(worktreePath: string | null): void {
    const island = this.island();
    const base = this.ctx.state.islands.find((i) => i.id === island?.basedOn);
    if (!island || !base || !worktreePath || this.ctx.state.campaign?.stackedStart !== 'together')
      return;
    this.ctx.outbox.effect({
      type: 'rebaseWorktree',
      islandId: island.id,
      worktreePath,
      onto: base.branch,
    });
  }

  private activityFinished({ toolUseId, ok }: { toolUseId: string; ok: boolean }): void {
    const r = this.record;
    const tool = r.runningTools.find((t) => t.toolUseId === toolUseId);
    r.runningTools = r.runningTools.filter((t) => t.toolUseId !== toolUseId);
    if (!tool) return;
    this.ctx.outbox.cue({
      type: 'activityFinished',
      heroId: r.id,
      kind: tool.kind,
      outcome: ok ? 'ok' : 'failed',
    });
    if (tool.kind === 'test') this.testFinished({ command: tool.detail ?? '', ok });
    if (tool.kind === 'edit' && ok) this.fileEdited(tool.detail ?? '');
  }

  /** Stall rule: the same test failing in a row; only a pass or another command resets it. */
  private testFinished({ command, ok }: { command: string; ok: boolean }): void {
    const w = this.record.watch;
    if (ok) {
      w.failingTest = null;
      w.editsSincePass = {};
      w.passedThisTurn = true;
      return;
    }
    w.failingTest =
      w.failingTest?.command === command
        ? { command, count: w.failingTest.count + 1 }
        : { command, count: 1 };
    if (w.failingTest.count >= this.limits().testFailures) {
      this.stall(`The same test failed ${w.failingTest.count} times in a row: ${command}`);
    }
  }

  /** Stall rule: one file edited over and over without a passing test. */
  private fileEdited(file: string): void {
    const w = this.record.watch;
    const count = (w.editsSincePass[file] ?? 0) + 1;
    w.editsSincePass[file] = count;
    if (count >= this.limits().fileEdits) {
      this.stall(`${file} was edited ${count} times without a passing test.`);
    }
  }

  private limits(): QuestSettings['stall'] {
    return this.ctx.state.settings.stall;
  }

  /** A stall rule fired: auto-pause and ask (spec §10 item 11). */
  private stall(reason: string): void {
    const r = this.record;
    if (r.stalled !== null) return;
    r.stalled = reason;
    r.queuedMessages = 0;
    this.ctx.outbox.effect({ type: 'interrupt', heroId: r.id });
    this.ctx.needsYou.ask({ kind: 'stalled', heroId: r.id, reason });
  }

  private clearStall(): void {
    this.record.stalled = null;
    this.record.watch = Hero.freshWatch();
    this.ctx.needsYou.removeFor(this.id, ['stalled']);
  }

  /** The gold pouch is empty (spec §7.3). */
  private outOfGold(): void {
    const r = this.record;
    if (r.outOfGold) return;
    r.outOfGold = true;
    r.inTurn = false;
    r.runningTools = [];
    if (r.cap) {
      this.ctx.needsYou.ask({
        kind: 'outOfGold',
        heroId: r.id,
        cap: r.cap.microUsd,
        capEnforcement: r.cap.enforcement,
      });
    }
  }

  private fail(message: string): void {
    const r = this.record;
    r.error = message;
    r.inTurn = false;
    r.runningTools = [];
    this.ctx.needsYou.ask({ kind: 'error', heroId: r.id, message });
  }

  private spent(): number {
    return this.record.gold.kind === 'unknown' ? 0 : this.record.gold.value;
  }

  private overBudget(): boolean {
    return this.record.cap !== null && this.spent() >= this.record.cap.microUsd;
  }

  /** For adapters with a native cap: what is left, so a restart can't reset the budget. */
  /** "Always allow for this quest": the rules join the hero's, for this session and any resume. */
  allowForQuest(rules: string[]): void {
    const r = this.record;
    r.allowRules = [...r.allowRules, ...rules.filter((rule) => !r.allowRules.includes(rule))];
  }

  /** The quest's allow rules, for starting or resuming a session. */
  private rules(): { allowRules?: string[] } {
    return this.record.allowRules.length > 0 ? { allowRules: [...this.record.allowRules] } : {};
  }

  private remainder(): { maxBudgetMicroUsd?: number } {
    const cap = this.record.cap;
    if (cap?.enforcement !== 'native') return {};
    return { maxBudgetMicroUsd: Math.max(0, cap.microUsd - this.spent()) };
  }

  /** Bring the session back: resume it if it has one, otherwise start over from what exists. */
  private revive(prompt?: string): void {
    const r = this.record;
    const island = this.island();
    if (!island?.worktreePath) {
      if (island) {
        this.ctx.outbox.effect({
          type: 'createWorktree',
          islandId: island.id,
          branch: island.branch,
          baseRef: island.baseRef,
        });
      }
      return;
    }
    r.sessionLive = true;
    if (r.sessionId) {
      this.ctx.outbox.effect({
        type: 'resumeSession',
        heroId: r.id,
        sessionId: r.sessionId,
        cwd: island.worktreePath,
        classId: r.classId,
        ...(prompt === undefined ? {} : { prompt }),
        ...this.remainder(),
        ...this.rules(),
      });
    } else {
      this.ctx.outbox.effect({
        type: 'startSession',
        heroId: r.id,
        cwd: island.worktreePath,
        classId: r.classId,
        prompt: this.prompt(),
        ...this.remainder(),
        ...this.rules(),
      });
    }
    this.watchSilence();
  }

  /** Get a paused hero going again with a message. */
  private continueWith({ text, priority }: { text: string; priority: 'now' | 'next' }): void {
    const r = this.record;
    if (!r.sessionLive) this.revive();
    if (r.inTurn && priority === 'next') r.queuedMessages++;
    this.ctx.outbox.effect({ type: 'sendMessage', heroId: r.id, text, priority });
  }

  private island() {
    return this.ctx.state.islands.find((i) => i.id === this.record.islandId);
  }

  private worktreePath(): string | null {
    return this.island()?.worktreePath ?? null;
  }

  private task() {
    return this.island()?.taskPoints.find((tp) => tp.id === this.record.taskPointId);
  }

  /** What the hero starts with: the task, then the elder's briefing when there was one. */
  private prompt(): string {
    const task = this.task();
    if (!task) return '';
    return task.briefing ? `${task.description}\n\n${task.briefing}` : task.description;
  }
}
