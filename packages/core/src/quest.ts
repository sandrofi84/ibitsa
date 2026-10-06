import type { Command, MicroUsd, Reading } from '@ibitsa/protocol';
import { Elder } from './elder';
import { Hero } from './hero';
import { newId } from './state';
import type { StepContext } from './step.types';

const TITLE_MAX = 60;

/** The campaign's lifecycle in M1: one quick quest with one island and one hero (spec §14.1). */
export class Quest {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /**
   * Totals are computed in core, never by front ends: one unknown makes the total unknown. The campaign's
   * total is its heroes' gold plus the elder's research once its cost is known (#101).
   */
  static totalGold(spenders: readonly { gold: Reading<MicroUsd> }[]): Reading<MicroUsd> {
    let total = 0;
    const bases: string[] = [];
    for (const { gold } of spenders) {
      if (gold.kind === 'unknown') return { kind: 'unknown' };
      total += gold.value;
      if (gold.kind === 'estimated') bases.push(gold.basis);
    }
    return bases.length > 0
      ? { kind: 'estimated', value: total, basis: [...new Set(bases)].join('; ') }
      : { kind: 'exact', value: total };
  }

  /** A quest's title: the task's first line, shortened. */
  static title(task: string): string {
    const firstLine = task.split('\n')[0]?.trim() ?? '';
    return firstLine.length > TITLE_MAX ? `${firstLine.slice(0, TITLE_MAX - 1)}…` : firstLine;
  }

  /**
   * A quick quest: one island, one hero. After the elder's brief it continues the planning campaign and
   * the hero is told what the elder found (spec §4.1); without the elder it starts a campaign of its own.
   */
  start(command: Extract<Command, { type: 'startQuest' }>): void {
    const state = this.ctx.state;
    const problem =
      state.campaign?.status === 'active'
        ? 'Finish or abandon the current quest first.'
        : state.campaign?.status === 'planning' && state.elder?.status === 'researching'
          ? 'The elder is still researching.'
          : undefined;
    if (problem) {
      this.ctx.outbox.reject(command.commandId, problem);
      return;
    }
    const title = Quest.title(command.description);
    const planning = state.campaign?.status === 'planning' ? state.campaign : null;
    const brief = planning && state.elder?.status === 'briefed' ? state.elder.brief : null;
    const campaignId = planning?.id ?? newId(state, 'c');
    const islandId = newId(state, 'i');
    const taskPointId = newId(state, 't');
    const heroId = newId(state, 'h');
    const branch = `ibitsa/${slug(title) || 'quest'}`;
    state.campaign = { id: campaignId, title, status: 'active', autoApprove: false };
    state.islands = [
      {
        id: islandId,
        name: title,
        branch,
        baseRef: command.baseRef,
        worktreePath: null,
        worktreeRemoved: false,
        taskPoints: [
          {
            id: taskPointId,
            title,
            description: command.description,
            ...(brief ? { briefing: Elder.briefing(brief) } : {}),
            state: 'active',
          },
        ],
      },
    ];
    state.heroes = [
      Hero.create({
        hero: {
          id: heroId,
          name: command.heroName,
          classId: command.classId,
          islandId,
          taskPointId,
        },
        settings: state.settings,
      }),
    ];
    this.ctx.needsYou.clear();
    this.ctx.outbox.effect({ type: 'createWorktree', islandId, branch, baseRef: command.baseRef });
  }

  /** Auto mode on or off for the running quest (#63). */
  setAutoApprove({ commandId, on }: { commandId: string; on: boolean }): void {
    const campaign = this.ctx.state.campaign;
    if (campaign?.status !== 'active') {
      this.ctx.outbox.reject(commandId, 'There is no quest running.');
      return;
    }
    campaign.autoApprove = on;
  }

  finish(commandId: string): void {
    if (this.ctx.state.campaign?.status !== 'active') {
      this.ctx.outbox.reject(commandId, 'No active quest.');
      return;
    }
    if (!this.ctx.state.heroes.every((h) => h.submitted && !h.inTurn)) {
      this.ctx.outbox.reject(commandId, 'The task has not been submitted yet.');
      return;
    }
    this.end('finished');
  }

  abandon(commandId: string): void {
    const status = this.ctx.state.campaign?.status;
    if (status !== 'active' && status !== 'planning') {
      this.ctx.outbox.reject(commandId, 'No active quest.');
      return;
    }
    this.end('abandoned');
  }

  removeWorktree({ commandId, islandId }: { commandId: string; islandId: string }): void {
    const island = this.ctx.state.islands.find((i) => i.id === islandId);
    if (this.ctx.state.campaign?.status === 'active') {
      this.ctx.outbox.reject(commandId, 'Finish or abandon the quest first.');
      return;
    }
    if (!island?.worktreePath) {
      this.ctx.outbox.reject(commandId, 'There is no worktree to remove.');
      return;
    }
    this.ctx.outbox.effect({
      type: 'removeWorktree',
      islandId: island.id,
      worktreePath: island.worktreePath,
      commandId,
    });
  }

  worktreeCreated({
    islandId,
    path,
    branch,
  }: {
    islandId: string;
    path: string;
    branch: string;
  }): void {
    const island = this.ctx.state.islands.find((i) => i.id === islandId);
    if (!island) return;
    island.worktreePath = path;
    island.branch = branch;
  }

  worktreeRemoved(islandId: string): void {
    const island = this.ctx.state.islands.find((i) => i.id === islandId);
    if (!island) return;
    island.worktreePath = null;
    island.worktreeRemoved = true;
  }

  private end(status: 'finished' | 'abandoned'): void {
    const state = this.ctx.state;
    if (state.campaign) state.campaign.status = status;
    new Elder(this.ctx).stop();
    for (const hero of state.heroes) {
      this.ctx.outbox.effect({ type: 'closeSession', heroId: hero.id });
      this.ctx.outbox.effect({ type: 'cancelTimer', timerId: Hero.silenceTimer(hero.id) });
    }
    this.ctx.needsYou.clear();
  }
}

/** Branch names: `ibitsa/<slug of the title>` (spec §5.3). */
function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}
