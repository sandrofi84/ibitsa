import type { Command, MicroUsd, Plan, PlanTask, Reading } from '@ibitsa/protocol';
import { taskOrder } from '@ibitsa/protocol';
import { Elder } from './elder';
import { Hero } from './hero';
import { Sitting } from './sitting';
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

  /** Branch names: `ibitsa/<slug of the title>` (spec §5.3). */
  static slug(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '');
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
          : Sitting.active(state.sitting)
            ? 'The council is sitting.'
            : undefined;
    if (problem) {
      this.ctx.outbox.reject(command.commandId, problem);
      return;
    }
    const title = Quest.title(command.description);
    const brief =
      state.campaign?.status === 'planning' && state.elder?.status === 'briefed'
        ? state.elder.brief
        : null;
    this.launch({
      title,
      tasks: [
        {
          title,
          description: command.description,
          ...(brief ? { briefing: Elder.briefing(brief) } : {}),
        },
      ],
      command,
    });
  }

  /** What a planned task's hero is told besides the task: where it sits in the plan and what to meet. */
  static briefing({
    plan,
    task,
    index,
    total,
  }: {
    plan: Plan;
    task: PlanTask;
    index: number;
    total: number;
  }): string {
    const lines = [`This is task ${index + 1} of ${total} in the council's plan: ${plan.goal}`];
    if (task.files.length > 0) {
      lines.push('', 'Files likely touched:', ...task.files.map((f) => `- ${f}`));
    }
    const criteria = task.criteria.flatMap((c) =>
      c.items.map((item) => `- ${item} (${c.councillorId})`),
    );
    if (criteria.length > 0) lines.push('', 'It is done when:', ...criteria);
    const decisions = plan.decisions.filter((d) => task.decisions.includes(d.id));
    if (decisions.length > 0) {
      lines.push('', 'Decisions already taken (keep to them):');
      for (const d of decisions) lines.push(`- ${d.id} ${d.title}: ${d.chosen}. ${d.why}`);
    }
    lines.push('', 'Commit this task, then call submit_task; the next task follows as a message.');
    return lines.join('\n');
  }

  /** One island with the given task points, the first one active, and one hero on it. */
  private launch({
    title,
    tasks,
    command,
  }: {
    title: string;
    tasks: { title: string; description: string; briefing?: string }[];
    command: { heroName: string; classId: string; baseRef: string };
  }): void {
    const state = this.ctx.state;
    const planning = state.campaign?.status === 'planning' ? state.campaign : null;
    const campaignId = planning?.id ?? newId(state, 'c');
    const islandId = newId(state, 'i');
    const taskPoints = tasks.map((task, i) => ({
      id: newId(state, 't'),
      ...task,
      state: i === 0 ? ('active' as const) : ('locked' as const),
    }));
    const heroId = newId(state, 'h');
    const branch = `ibitsa/${Quest.slug(title) || 'quest'}`;
    state.campaign = {
      id: campaignId,
      title,
      status: 'active',
      autoApprove: false,
      branching: 'separate',
      stackedStart: null,
      baseRef: command.baseRef,
    };
    state.islands = [
      {
        id: islandId,
        name: title,
        branch,
        baseRef: command.baseRef,
        worktreePath: null,
        worktreeRemoved: false,
        launched: true,
        basedOn: null,
        behind: false,
        taskPoints,
      },
    ];
    state.heroes = [
      Hero.create({
        hero: {
          id: heroId,
          name: command.heroName,
          classId: command.classId,
          islandId,
          taskPointId: taskPoints[0]?.id ?? '',
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
    const { heroes, islands } = this.ctx.state;
    const open = heroes.filter((h) => !h.submitted || h.inTurn);
    if (open.length > 0) {
      // With several parties, say which islands are still open (#126).
      const names = open.map((h) => islands.find((i) => i.id === h.islandId)?.name ?? h.name);
      this.ctx.outbox.reject(
        commandId,
        heroes.length > 1
          ? `Not every island is submitted yet: ${names.join(', ')}.`
          : 'The task has not been submitted yet.',
      );
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
    new Sitting(this.ctx).stop('The quest was abandoned.');
    for (const hero of state.heroes) {
      this.ctx.outbox.effect({ type: 'closeSession', heroId: hero.id });
      this.ctx.outbox.effect({ type: 'cancelTimer', timerId: Hero.silenceTimer(hero.id) });
    }
    this.ctx.needsYou.clear();
    // PRs are polled while the campaign runs (§5.6); after it ends they're followed on the git host.
    if (state.islands.some((i) => i.remote?.pullRequest)) {
      this.ctx.outbox.effect({ type: 'watchPullRequests', numbers: [] });
    }
  }
}
