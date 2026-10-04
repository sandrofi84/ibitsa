import type { AgentEvent, Command, Cue } from '@ibitsa/protocol';
import type { Effect } from './effects';
import type { CoreInput, GameMasterEvent } from './inputs';
import { describePermission } from './permissions';
import type { CoreState, Hero } from './state';

export interface StepResult {
  state: CoreState;
  cues: Cue[];
  effects: Effect[];
}

/** No events for this long, with no tool running mid-turn, means core has lost contact (§5.4). */
export const SILENCE_MS = 5 * 60_000;
const TITLE_MAX = 60;

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

  private reject(commandId: string, reason: string): void {
    this.cues.push({ type: 'commandRejected', commandId, reason });
  }

  private removeItems(predicate: (i: CoreState['needsYou'][number]) => boolean): void {
    this.state.needsYou = this.state.needsYou.filter((i) => !predicate(i));
  }

  /** Arm the silence timer while a turn is in progress with no tool running; disarm otherwise. */
  private watchSilence(hero: Hero): void {
    const waiting = this.state.needsYou.some(
      (i) => i.heroId === hero.id && (i.kind === 'permission' || i.kind === 'question'),
    );
    const expectingEvents =
      (!hero.sessionStarted || (hero.inTurn && hero.runningTools.length === 0)) &&
      !waiting &&
      !hero.resting &&
      hero.error === null;
    this.effects.push(
      expectingEvents
        ? { type: 'setTimer', timerId: silenceTimer(hero.id), at: this.t + SILENCE_MS }
        : { type: 'cancelTimer', timerId: silenceTimer(hero.id) },
    );
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
        if (hero.inTurn && command.priority === 'next') hero.queuedMessages++;
        this.removeItems((i) => i.heroId === hero.id && i.kind === 'reply');
        this.effects.push({
          type: 'sendMessage',
          heroId: hero.id,
          text: command.text,
          priority: command.priority,
        });
        return;
      }
      case 'stopHero': {
        const hero = this.hero(command.heroId);
        if (!hero) {
          this.reject(command.commandId, 'No such hero.');
          return;
        }
        hero.queuedMessages = 0;
        this.effects.push({ type: 'interrupt', heroId: hero.id });
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
      case 'resumeHero':
      case 'raiseBudget':
      case 'removeWorktree':
        this.reject(command.commandId, 'Not available yet.');
        return;
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
    this.removeItems((i) => i.heroId === hero.id && i.kind === 'reply');
    for (const island of this.state.islands) {
      for (const tp of island.taskPoints) {
        if (tp.id === hero.taskPointId) tp.state = 'doneUnreviewed';
      }
    }
  }

  // ---------- game master results ----------

  gameMaster(event: GameMasterEvent): void {
    switch (event.type) {
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
          });
          this.watchSilence(hero);
        }
        return;
      }
      case 'worktreeFailed':
        for (const hero of this.state.heroes.filter((h) => h.islandId === event.islandId)) {
          hero.error = `Could not create the worktree: ${event.message}`;
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
    }
  }

  // ---------- agent events ----------

  agent(heroId: string, event: AgentEvent): void {
    const hero = this.hero(heroId);
    if (!hero) return;
    hero.unknownReason = null; // any event proves contact
    switch (event.type) {
      case 'sessionStarted':
        hero.sessionStarted = true;
        hero.inTurn = true; // the session starts by working on its prompt
        break;
      case 'turnStarted':
        hero.inTurn = true;
        hero.queuedMessages = 0;
        this.removeItems((i) => i.heroId === hero.id && i.kind === 'reply');
        break;
      case 'turnEnded':
        hero.runningTools = [];
        if (event.queuedTurns > 0) break;
        hero.inTurn = false;
        hero.queuedMessages = 0;
        if (!hero.submitted) {
          this.state.needsYou.push({
            kind: 'reply',
            id: this.newId('n'),
            heroId: hero.id,
            text: hero.lastMessage ?? '',
          });
        }
        break;
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
        if (tool) {
          this.cues.push({
            type: 'activityFinished',
            heroId: hero.id,
            kind: tool.kind,
            outcome: event.outcome,
          });
        }
        break;
      }
      case 'message':
        hero.lastMessage = event.text;
        break;
      case 'permission': {
        const id = this.newId('n');
        const cwd =
          this.state.islands.find((i) => i.id === hero.islandId)?.worktreePath ?? '(unknown)';
        this.state.needsYou.push({
          kind: 'permission',
          id,
          heroId: hero.id,
          requestId: event.requestId,
          ...describePermission(event.tool, event.input),
          cwd,
        });
        this.cues.push({ type: 'needsYouAdded', itemId: id });
        break;
      }
      case 'question': {
        const id = this.newId('n');
        this.state.needsYou.push({
          kind: 'question',
          id,
          heroId: hero.id,
          requestId: event.requestId,
          questions: event.questions,
        });
        this.cues.push({ type: 'needsYouAdded', itemId: id });
        break;
      }
      case 'usage':
        if (event.contextUsed !== undefined && event.contextMax !== undefined) {
          hero.hp = { kind: 'exact', value: { used: event.contextUsed, max: event.contextMax } };
        }
        if (event.totalCost !== undefined) hero.gold = { kind: 'exact', value: event.totalCost };
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
        hero.outOfGold = true;
        hero.inTurn = false;
        hero.runningTools = [];
        break;
      case 'retrying':
        this.cues.push({ type: 'retrying', heroId: hero.id, reason: event.reason });
        break;
      case 'error':
        hero.error = event.message;
        hero.inTurn = false;
        hero.runningTools = [];
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

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
