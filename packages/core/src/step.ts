import type { AgentEvent, Command, Cue } from '@ibitsa/protocol';
import type { Effect } from './effects';
import type { CoreInput, GameMasterEvent } from './inputs';
import { describePermission } from './permissions';
import { capFor, overBudget, remainder } from './pouch';
import { type CoreState, freshWatch, type Hero, type PendingItem } from './state';
import { afterEdit, afterTest, afterTurn } from './watch';

export interface StepResult {
  state: CoreState;
  cues: Cue[];
  effects: Effect[];
}

/** No events for this long, with no tool running mid-turn, means core has lost contact (§5.4). */
export const SILENCE_MS = 5 * 60_000;
const TITLE_MAX = 60;
/** What a hero is told when it should pick its work back up. */
export const CONTINUE_PROMPT = 'Continue with the task.';

/** The whole game master: pure, deterministic, no I/O (ADR 0001). */
export function step(state: CoreState, input: CoreInput): StepResult {
  const ctx = new Context(JSON.parse(JSON.stringify(state)) as CoreState, input.t);
  switch (input.kind) {
    case 'command':
      ctx.command(input.command);
      break;
    case 'agent':
      ctx.agent(input.heroId, input.event);
      break;
    case 'gm':
      ctx.gameMaster(input.event);
      break;
    case 'timer':
      ctx.timer(input.timerId);
      break;
  }
  return { state: ctx.state, cues: ctx.cues, effects: ctx.effects };
}

const silenceTimer = (heroId: string) => `silence:${heroId}`;

class Context {
  readonly cues: Cue[] = [];
  readonly effects: Effect[] = [];

  constructor(
    readonly state: CoreState,
    private readonly t: number,
  ) {}

  private newId(prefix: string): string {
    return `${prefix}${this.state.nextId++}`;
  }

  private hero(heroId: string): Hero | undefined {
    return this.state.heroes.find((h) => h.id === heroId);
  }

  private island(hero: Hero) {
    return this.state.islands.find((i) => i.id === hero.islandId);
  }

  private reject(commandId: string, reason: string): void {
    this.cues.push({ type: 'commandRejected', commandId, reason });
  }

  private removeItems(predicate: (i: PendingItem) => boolean): void {
    this.state.needsYou = this.state.needsYou.filter((i) => !predicate(i));
  }

  private removeHeroItems(hero: Hero, kinds: PendingItem['kind'][]): void {
    this.removeItems((i) => i.heroId === hero.id && kinds.includes(i.kind));
  }

  /** Adds a "Needs you" item and announces it. One item of each kind per hero at most. */
  private ask(item: DistributiveOmit<PendingItem, 'id'>): void {
    if (this.state.needsYou.some((i) => i.heroId === item.heroId && i.kind === item.kind)) {
      if (item.kind !== 'permission' && item.kind !== 'question') return;
    }
    const id = this.newId('n');
    const { kind, ...rest } = item;
    this.state.needsYou.push({ kind, id, ...rest } as PendingItem);
    if (item.kind !== 'reply') this.cues.push({ type: 'needsYouAdded', itemId: id });
  }

  /** Arm the silence timer while a turn is in progress with no tool running; disarm otherwise. */
  private watchSilence(hero: Hero): void {
    const waiting = this.state.needsYou.some(
      (i) => i.heroId === hero.id && (i.kind === 'permission' || i.kind === 'question'),
    );
    const expectingEvents =
      (!hero.sessionStarted || (hero.inTurn && hero.runningTools.length === 0)) &&
      hero.sessionLive &&
      !waiting &&
      !hero.resting &&
      hero.error === null &&
      hero.stalled === null &&
      !hero.outOfGold;
    this.effects.push(
      expectingEvents
        ? { type: 'setTimer', timerId: silenceTimer(hero.id), at: this.t + SILENCE_MS }
        : { type: 'cancelTimer', timerId: silenceTimer(hero.id) },
    );
  }

  // ---------- rules that pause a hero ----------

  /** Stall rules fired: auto-pause and ask (spec §10 item 11). */
  private stall(hero: Hero, reason: string): void {
    if (hero.stalled !== null) return;
    hero.stalled = reason;
    hero.queuedMessages = 0;
    this.effects.push({ type: 'interrupt', heroId: hero.id });
    this.ask({ kind: 'stalled', heroId: hero.id, reason });
  }

  private clearStall(hero: Hero): void {
    hero.stalled = null;
    hero.watch = freshWatch();
    this.removeHeroItems(hero, ['stalled']);
  }

  /** The gold pouch is empty (spec §7.3). */
  private outOfGold(hero: Hero): void {
    if (hero.outOfGold) return;
    hero.outOfGold = true;
    hero.inTurn = false;
    hero.runningTools = [];
    if (hero.cap) {
      this.ask({
        kind: 'outOfGold',
        heroId: hero.id,
        cap: hero.cap.microUsd,
        capEnforcement: hero.cap.enforcement,
      });
    }
  }

  private fail(hero: Hero, message: string): void {
    hero.error = message;
    hero.inTurn = false;
    hero.runningTools = [];
    this.ask({ kind: 'error', heroId: hero.id, message });
  }

  /** Bring a hero's session back: resume it if it has one, otherwise start over from what exists. */
  private revive(hero: Hero, prompt?: string): void {
    const island = this.island(hero);
    if (!island?.worktreePath) {
      if (island) {
        this.effects.push({
          type: 'createWorktree',
          islandId: island.id,
          branch: island.branch,
          baseRef: island.baseRef,
        });
      }
      return;
    }
    hero.sessionLive = true;
    if (hero.sessionId) {
      this.effects.push({
        type: 'resumeSession',
        heroId: hero.id,
        sessionId: hero.sessionId,
        cwd: island.worktreePath,
        classId: hero.classId,
        ...(prompt === undefined ? {} : { prompt }),
        ...remainder(hero),
      });
    } else {
      const task = island.taskPoints.find((tp) => tp.id === hero.taskPointId);
      this.effects.push({
        type: 'startSession',
        heroId: hero.id,
        cwd: island.worktreePath,
        classId: hero.classId,
        prompt: task?.description ?? '',
        ...remainder(hero),
      });
    }
    this.watchSilence(hero);
  }

  /** Get a paused hero going again with a message. */
  private continueWith(
    hero: Hero,
    { text, priority }: { text: string; priority: 'now' | 'next' },
  ): void {
    if (!hero.sessionLive) this.revive(hero);
    if (hero.inTurn && priority === 'next') hero.queuedMessages++;
    this.effects.push({ type: 'sendMessage', heroId: hero.id, text, priority });
  }

  // ---------- commands ----------

  command(command: Command): void {
    switch (command.type) {
      case 'hello':
        return; // handled by the runtime (welcome + snapshot)
      case 'startQuest':
        this.startQuest(command);
        return;
      case 'sendMessage': {
        const hero = this.hero(command.heroId);
        if (!hero) {
          this.reject(command.commandId, 'No such hero.');
          return;
        }
        if (!hero.sessionStarted) {
          this.reject(command.commandId, 'The hero has not arrived yet.');
          return;
        }
        if (hero.outOfGold) {
          this.reject(command.commandId, 'The hero is out of gold. Raise the cap first.');
          return;
        }
        // Answering a stall with a message is one of its choices (spec §10 item 11).
        if (hero.stalled !== null) this.clearStall(hero);
        this.removeHeroItems(hero, ['reply']);
        this.continueWith(hero, { text: command.text, priority: command.priority });
        return;
      }
      case 'stopHero': {
        const hero = this.hero(command.heroId);
        if (!hero) {
          this.reject(command.commandId, 'No such hero.');
          return;
        }
        hero.queuedMessages = 0;
        if (hero.stalled !== null) this.clearStall(hero);
        if (hero.error !== null) {
          hero.error = null;
          this.removeHeroItems(hero, ['error']);
        }
        if (hero.outOfGold) {
          hero.outOfGold = false;
          this.removeHeroItems(hero, ['outOfGold']);
        }
        if (hero.sessionLive) this.effects.push({ type: 'interrupt', heroId: hero.id });
        this.watchSilence(hero);
        return;
      }
      case 'answerPermission':
      case 'answerQuestion': {
        const item = this.state.needsYou.find((i) => i.id === command.itemId);
        const expected = command.type === 'answerPermission' ? 'permission' : 'question';
        if (!item || item.kind !== expected) {
          this.reject(command.commandId, 'That request is no longer waiting.');
          return;
        }
        this.removeItems((i) => i.id === item.id);
        if (item.kind === 'permission' && command.type === 'answerPermission') {
          this.effects.push({
            type: 'answerPermission',
            heroId: item.heroId,
            requestId: item.requestId,
            decision: command.decision,
            ...(command.note === undefined ? {} : { note: command.note }),
          });
        } else if (item.kind === 'question' && command.type === 'answerQuestion') {
          this.effects.push({
            type: 'answerQuestion',
            heroId: item.heroId,
            requestId: item.requestId,
            answers: command.answers,
          });
        }
        const hero = this.hero(item.heroId);
        if (hero) this.watchSilence(hero);
        return;
      }
      case 'resumeHero': {
        const hero = this.hero(command.heroId);
        if (!hero) {
          this.reject(command.commandId, 'No such hero.');
          return;
        }
        if (hero.stalled !== null) {
          this.clearStall(hero);
          this.continueWith(hero, { text: CONTINUE_PROMPT, priority: 'next' });
          return;
        }
        if (hero.error !== null || hero.unknownReason !== null || !hero.sessionLive) {
          const wasWorking = hero.unknownReason !== null || hero.error !== null;
          hero.error = null;
          hero.unknownReason = null;
          this.removeHeroItems(hero, ['error']);
          this.revive(hero, wasWorking && !hero.submitted ? CONTINUE_PROMPT : undefined);
          return;
        }
        this.reject(command.commandId, 'Nothing to resume.');
        return;
      }
      case 'raiseBudget': {
        const hero = this.hero(command.heroId);
        if (!hero?.cap) {
          this.reject(command.commandId, 'This hero has no gold pouch.');
          return;
        }
        hero.cap = { ...hero.cap, microUsd: hero.cap.microUsd + command.addMicroUsd };
        if (hero.outOfGold && !overBudget(hero)) {
          hero.outOfGold = false;
          this.removeHeroItems(hero, ['outOfGold']);
          if (hero.cap.enforcement === 'native') this.revive(hero, CONTINUE_PROMPT);
          else this.continueWith(hero, { text: CONTINUE_PROMPT, priority: 'next' });
        }
        return;
      }
      case 'markDone': {
        const hero = this.hero(command.heroId);
        if (!hero) {
          this.reject(command.commandId, 'No such hero.');
          return;
        }
        if (hero.inTurn) {
          this.reject(command.commandId, 'The hero is still working.');
          return;
        }
        this.submit(hero, '');
        return;
      }
      case 'finishQuest': {
        const campaign = this.state.campaign;
        if (campaign?.status !== 'active') {
          this.reject(command.commandId, 'No active quest.');
          return;
        }
        if (!this.state.heroes.every((h) => h.submitted && !h.inTurn)) {
          this.reject(command.commandId, 'The task has not been submitted yet.');
          return;
        }
        this.endQuest('finished');
        return;
      }
      case 'abandonQuest':
        if (this.state.campaign?.status !== 'active') {
          this.reject(command.commandId, 'No active quest.');
          return;
        }
        this.endQuest('abandoned');
        return;
      case 'removeWorktree': {
        const island = this.state.islands.find((i) => i.id === command.islandId);
        if (this.state.campaign?.status === 'active') {
          this.reject(command.commandId, 'Finish or abandon the quest first.');
          return;
        }
        if (!island?.worktreePath) {
          this.reject(command.commandId, 'There is no worktree to remove.');
          return;
        }
        this.effects.push({
          type: 'removeWorktree',
          islandId: island.id,
          worktreePath: island.worktreePath,
          commandId: command.commandId,
        });
        return;
      }
    }
  }

  private startQuest(command: Extract<Command, { type: 'startQuest' }>): void {
    if (this.state.campaign?.status === 'active') {
      this.reject(command.commandId, 'Finish or abandon the current quest first.');
      return;
    }
    const firstLine = command.description.split('\n')[0]?.trim() ?? '';
    const title =
      firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
    const campaignId = this.newId('c');
    const islandId = this.newId('i');
    const taskPointId = this.newId('t');
    const heroId = this.newId('h');
    const branch = `ibitsa/${slug(title) || 'quest'}`;
    this.state.campaign = { id: campaignId, title, status: 'active' };
    this.state.islands = [
      {
        id: islandId,
        name: title,
        branch,
        baseRef: command.baseRef,
        worktreePath: null,
        taskPoints: [{ id: taskPointId, title, description: command.description, state: 'active' }],
      },
    ];
    const hero: Hero = {
      id: heroId,
      name: command.heroName,
      classId: command.classId,
      islandId,
      taskPointId,
      sessionStarted: false,
      inTurn: false,
      runningTools: [],
      lastMessage: null,
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
      cap: capFor(this.state.settings),
      watch: freshWatch(),
    };
    this.state.heroes = [hero];
    this.state.needsYou = [];
    this.effects.push({ type: 'createWorktree', islandId, branch, baseRef: command.baseRef });
  }

  private endQuest(status: 'finished' | 'abandoned'): void {
    if (this.state.campaign) this.state.campaign.status = status;
    for (const hero of this.state.heroes) {
      this.effects.push({ type: 'closeSession', heroId: hero.id });
      this.effects.push({ type: 'cancelTimer', timerId: silenceTimer(hero.id) });
    }
    this.state.needsYou = [];
  }

  private submit(hero: Hero, summary: string): void {
    hero.submitted = { summary };
    this.removeHeroItems(hero, ['reply']);
    for (const island of this.state.islands) {
      for (const tp of island.taskPoints) {
        if (tp.id === hero.taskPointId) tp.state = 'doneUnreviewed';
      }
    }
  }

  // ---------- game master results ----------

  gameMaster(event: GameMasterEvent): void {
    switch (event.type) {
      case 'questSettings': {
        const { type: _type, ...settings } = event;
        this.state.settings = settings;
        return;
      }
      case 'worktreeCreated': {
        const island = this.state.islands.find((i) => i.id === event.islandId);
        if (!island) return;
        island.worktreePath = event.path;
        island.branch = event.branch;
        for (const hero of this.state.heroes.filter((h) => h.islandId === island.id)) {
          const task = island.taskPoints.find((tp) => tp.id === hero.taskPointId);
          this.effects.push({
            type: 'startSession',
            heroId: hero.id,
            cwd: event.path,
            classId: hero.classId,
            prompt: task?.description ?? '',
            ...remainder(hero),
          });
          this.watchSilence(hero);
        }
        return;
      }
      case 'worktreeFailed':
        for (const hero of this.state.heroes.filter((h) => h.islandId === event.islandId)) {
          this.fail(hero, `Could not create the worktree: ${event.message}`);
          this.watchSilence(hero);
        }
        return;
      case 'submitChecked': {
        const hero = this.hero(event.heroId);
        if (!hero || hero.pendingSubmit?.toolUseId !== event.toolUseId) return;
        const { summary } = hero.pendingSubmit;
        hero.pendingSubmit = null;
        if (event.ok) {
          this.submit(hero, summary);
          this.effects.push({
            type: 'completeSubmit',
            heroId: hero.id,
            toolUseId: event.toolUseId,
            accepted: true,
          });
        } else {
          this.effects.push({
            type: 'completeSubmit',
            heroId: hero.id,
            toolUseId: event.toolUseId,
            accepted: false,
            reason: event.reason ?? 'The submit check failed.',
          });
        }
        return;
      }
      case 'diffObserved': {
        const hero = this.hero(event.heroId);
        if (!hero) return;
        const reason = afterTurn({
          watch: hero.watch,
          diffHash: event.hash,
          limits: this.state.settings.stall,
        });
        if (reason) this.stall(hero, reason);
        return;
      }
      case 'worktreeRemoved': {
        const island = this.state.islands.find((i) => i.id === event.islandId);
        if (island) island.worktreePath = null;
        return;
      }
      case 'worktreeRemoveFailed':
        this.reject(event.commandId, event.reason);
        return;
      case 'runtimeRestarted':
        this.restarted();
        return;
    }
  }

  /** Every session died with the old process (spec §12): say so, and offer to resume. */
  private restarted(): void {
    if (this.state.campaign?.status !== 'active') return;
    // Requests waiting on the old process can no longer be answered.
    this.removeItems((i) => i.kind === 'permission' || i.kind === 'question');
    for (const hero of this.state.heroes) {
      const wasActive = !hero.submitted || hero.inTurn;
      hero.sessionLive = false;
      hero.inTurn = false;
      hero.runningTools = [];
      hero.resting = false;
      hero.pendingSubmit = null;
      this.effects.push({ type: 'cancelTimer', timerId: silenceTimer(hero.id) });
      if (!wasActive || hero.error !== null || hero.outOfGold) continue;
      hero.unknownReason = 'Session not resumed after a restart.';
      this.ask({
        kind: 'error',
        heroId: hero.id,
        message: 'The session stopped when VS Code reloaded.',
      });
    }
  }

  // ---------- agent events ----------

  agent(heroId: string, event: AgentEvent): void {
    const hero = this.hero(heroId);
    if (!hero) return;
    hero.unknownReason = null; // any event proves contact
    const limits = this.state.settings.stall;
    switch (event.type) {
      case 'sessionStarted':
        hero.sessionStarted = true;
        hero.sessionLive = true;
        hero.sessionId = event.sessionId;
        hero.inTurn = true; // the session starts by working on its prompt
        break;
      case 'turnStarted':
        hero.inTurn = true;
        hero.queuedMessages = 0;
        this.removeHeroItems(hero, ['reply']);
        break;
      case 'turnEnded': {
        hero.runningTools = [];
        const worktreePath = this.island(hero)?.worktreePath;
        if (worktreePath) this.effects.push({ type: 'observeDiff', heroId: hero.id, worktreePath });
        if (event.queuedTurns > 0) break;
        hero.inTurn = false;
        hero.queuedMessages = 0;
        if (hero.cap?.enforcement === 'native' && overBudget(hero)) this.outOfGold(hero);
        const paused = hero.stalled !== null || hero.outOfGold || hero.error !== null;
        if (!hero.submitted && !paused) {
          this.ask({ kind: 'reply', heroId: hero.id, text: hero.lastMessage ?? '' });
        }
        break;
      }
      case 'activityStarted':
        hero.inTurn = true;
        hero.runningTools.push({
          toolUseId: event.toolUseId,
          kind: event.kind,
          ...(event.detail === undefined ? {} : { detail: event.detail }),
        });
        break;
      case 'activityFinished': {
        const tool = hero.runningTools.find((r) => r.toolUseId === event.toolUseId);
        hero.runningTools = hero.runningTools.filter((r) => r.toolUseId !== event.toolUseId);
        if (!tool) break;
        this.cues.push({
          type: 'activityFinished',
          heroId: hero.id,
          kind: tool.kind,
          outcome: event.outcome,
        });
        const detail = tool.detail ?? '';
        const reason =
          tool.kind === 'test'
            ? afterTest({ watch: hero.watch, command: detail, ok: event.outcome === 'ok', limits })
            : tool.kind === 'edit' && event.outcome === 'ok'
              ? afterEdit({ watch: hero.watch, file: detail, limits })
              : null;
        if (reason) this.stall(hero, reason);
        break;
      }
      case 'message':
        hero.lastMessage = event.text;
        break;
      case 'permission': {
        const cwd = this.island(hero)?.worktreePath ?? '(unknown)';
        this.ask({
          kind: 'permission',
          heroId: hero.id,
          requestId: event.requestId,
          ...describePermission(event.tool, event.input),
          cwd,
        });
        break;
      }
      case 'question':
        this.ask({
          kind: 'question',
          heroId: hero.id,
          requestId: event.requestId,
          questions: event.questions,
        });
        break;
      case 'usage':
        if (event.contextUsed !== undefined && event.contextMax !== undefined) {
          hero.hp = { kind: 'exact', value: { used: event.contextUsed, max: event.contextMax } };
        }
        if (event.totalCost !== undefined) {
          hero.gold = { kind: 'exact', value: event.totalCost };
          // Without a native cap, core enforces the pouch at each usage report (may overshoot a turn).
          if (hero.cap?.enforcement === 'turnEnd' && overBudget(hero) && !hero.outOfGold) {
            this.effects.push({ type: 'interrupt', heroId: hero.id });
            this.outOfGold(hero);
          }
        }
        break;
      case 'resting':
        hero.resting = true;
        break;
      case 'compacted':
        hero.resting = false;
        if (event.postTokens !== undefined && hero.hp.kind !== 'unknown') {
          hero.hp = { kind: 'exact', value: { used: event.postTokens, max: hero.hp.value.max } };
        }
        break;
      case 'taskSubmitted':
        hero.pendingSubmit = { toolUseId: event.toolUseId, summary: event.summary };
        this.effects.push({ type: 'checkSubmit', heroId: hero.id, toolUseId: event.toolUseId });
        break;
      case 'budgetExhausted':
        this.outOfGold(hero);
        break;
      case 'retrying':
        this.cues.push({ type: 'retrying', heroId: hero.id, reason: event.reason });
        break;
      case 'error':
        this.fail(hero, event.message);
        break;
    }
    this.watchSilence(hero);
  }

  // ---------- timers ----------

  timer(timerId: string): void {
    const hero = this.state.heroes.find((h) => silenceTimer(h.id) === timerId);
    if (!hero) return;
    const minutes = Math.round(SILENCE_MS / 60_000);
    hero.unknownReason = hero.sessionStarted
      ? `No events for ${minutes} min.`
      : `The session has not started after ${minutes} min.`;
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
