import type { Command } from '@ibitsa/protocol';
import { planIslands, taskOrder } from '@ibitsa/protocol';
import { Hero } from './hero';
import { Quest } from './quest';
import { newId } from './state';
import type { CoreState, Island } from './state.types';
import type { StepContext } from './step.types';

const DONE = new Set(['doneUnreviewed', 'done']);

/**
 * A campaign with a party per island (spec §5.1, §5.3, #121). It owns the schedule: which islands start
 * and when (parallel slots, dependencies on other islands' tasks, stacked islands after the one before),
 * when a held hero gets its next task, and the campaign's cap. It runs after every step, so nothing that
 * frees a slot or finishes a task can be missed, and it does nothing for a quick quest.
 */
export class Campaign {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** Why an island that hasn't started is waiting; `slot` means it could start once one is free. */
  static blockReason(state: CoreState, island: Island): 'slot' | 'previousIsland' | 'dependency' {
    const base = state.islands.find((i) => i.id === island.basedOn);
    if (base) {
      const ready =
        state.campaign?.stackedStart === 'together'
          ? base.worktreePath !== null
          : Campaign.cleared(base);
      if (!ready) return 'previousIsland';
    }
    const first = island.taskPoints[0];
    return first && Campaign.unmet({ state, taskPoint: first }).length > 0 ? 'dependency' : 'slot';
  }

  /** The plan tasks a task point waits on that aren't done yet. */
  static unmet({
    state,
    taskPoint,
  }: {
    state: CoreState;
    taskPoint: Island['taskPoints'][number];
  }): string[] {
    return (taskPoint.dependsOn ?? []).filter(
      (dep) =>
        !state.islands.some((i) =>
          i.taskPoints.some((tp) => tp.planTaskId === dep && DONE.has(tp.state)),
        ),
    );
  }

  /** Every task on the island is done (until reviews exist, M5: submitted). */
  static cleared(island: Island): boolean {
    return island.taskPoints.every((tp) => DONE.has(tp.state));
  }

  start(command: Extract<Command, { type: 'startCampaign' }>): void {
    const state = this.ctx.state;
    const campaign = state.campaign;
    const plan =
      campaign?.status === 'planning' && state.sitting?.status === 'approved'
        ? state.sitting.plans.find((p) => p.outcome.kind === 'approved')?.plan
        : undefined;
    if (!campaign || !plan) {
      this.ctx.outbox.reject(command.commandId, 'There is no approved plan to carry out.');
      return;
    }
    const { islands, branching } = planIslands(plan);
    const parties = new Map(command.parties.map((p) => [p.islandId, p]));
    const missing = islands.filter((i) => !parties.has(i.id)).map((i) => i.id);
    const strangers = command.parties.filter((p) => !islands.some((i) => i.id === p.islandId));
    if (missing.length > 0 || strangers.length > 0 || parties.size !== command.parties.length) {
      this.ctx.outbox.reject(
        command.commandId,
        missing.length > 0
          ? `Every island needs a party: ${missing.join(', ')}.`
          : 'Each party needs an island of the plan, once.',
      );
      return;
    }
    const tasks = new Map(plan.tasks.map((t) => [t.id, t]));
    const order = taskOrder(plan.tasks) ?? plan.tasks;
    campaign.status = 'active';
    campaign.branching = branching;
    campaign.stackedStart = branching === 'stacked' ? (command.stackedStart ?? 'cleared') : null;
    campaign.baseRef = command.baseRef;
    const branches = new Set<string>();
    state.islands = [];
    state.heroes = [];
    for (const planIsland of islands) {
      const before = state.islands.at(-1);
      const id = newId(state, 'i');
      const taskPoints = planIsland.tasks.flatMap((taskId) => {
        const task = tasks.get(taskId);
        if (!task) return [];
        return [
          {
            id: newId(state, 't'),
            title: task.title,
            description: task.description,
            briefing: Quest.briefing({
              plan,
              task,
              index: order.indexOf(task),
              total: order.length,
            }),
            state: 'locked' as const,
            planTaskId: task.id,
            dependsOn: task.dependsOn,
          },
        ];
      });
      const basedOn = branching === 'stacked' && before ? before : null;
      state.islands.push({
        id,
        name: planIsland.title,
        branch: unique({
          branch: `ibitsa/${Quest.slug(planIsland.title) || 'island'}`,
          taken: branches,
        }),
        baseRef: basedOn ? basedOn.branch : command.baseRef,
        worktreePath: null,
        worktreeRemoved: false,
        launched: false,
        basedOn: basedOn?.id ?? null,
        behind: false,
        taskPoints,
      });
      const party = parties.get(planIsland.id);
      if (!party) continue;
      const hero = Hero.create({
        hero: {
          id: newId(state, 'h'),
          name: party.heroName,
          classId: party.classId,
          islandId: id,
          taskPointId: taskPoints[0]?.id ?? '',
        },
        settings: state.settings,
      });
      if (party.budgetMicroUsd !== undefined) {
        hero.cap =
          party.budgetMicroUsd === null || state.settings.budget === 'none'
            ? null
            : { microUsd: party.budgetMicroUsd, enforcement: state.settings.budget };
      }
      state.heroes.push(hero);
    }
    this.ctx.needsYou.clear();
  }

  /** Start what can start, and hand held heroes their next task once its dependencies are done. */
  schedule(): void {
    const state = this.ctx.state;
    if (state.campaign?.status !== 'active') return;
    for (const record of state.heroes) {
      if (record.heldFor.length === 0) continue;
      const hero = new Hero({ record, ctx: this.ctx });
      const task = record.taskPointId
        ? state.islands.flatMap((i) => i.taskPoints).find((tp) => tp.id === record.taskPointId)
        : undefined;
      if (task && Campaign.unmet({ state, taskPoint: task }).length === 0) hero.takeNextTask();
      else if (task) record.heldFor = Campaign.unmet({ state, taskPoint: task });
    }
    let busy = state.heroes.filter((h) => {
      const island = state.islands.find((i) => i.id === h.islandId);
      return island?.launched && !h.submitted;
    }).length;
    for (const island of state.islands) {
      if (island.launched || island.worktreeRemoved) continue;
      if (busy >= state.settings.maxParallel) return;
      if (Campaign.blockReason(state, island) !== 'slot') continue;
      island.launched = true;
      // Stacked: branch from the island before as git named it (it may have added a suffix).
      const base = state.islands.find((i) => i.id === island.basedOn);
      if (base) island.baseRef = base.branch;
      const first = island.taskPoints[0];
      if (first) first.state = 'active';
      this.ctx.outbox.effect({
        type: 'createWorktree',
        islandId: island.id,
        branch: island.branch,
        baseRef: island.baseRef,
      });
      busy++;
    }
  }

  /** Stacked, all at once: the result of rebasing onto the island before (#121). */
  rebased({
    islandId,
    outcome,
  }: {
    islandId: string;
    outcome: 'upToDate' | 'rebased' | 'conflict';
  }): void {
    const island = this.ctx.state.islands.find((i) => i.id === islandId);
    if (!island) return;
    if (outcome !== 'conflict') {
      island.behind = false;
      return;
    }
    if (island.behind) return;
    island.behind = true;
    const base = this.ctx.state.islands.find((i) => i.id === island.basedOn);
    const record = this.ctx.state.heroes.find((h) => h.islandId === islandId);
    if (!record || !base) return;
    this.ctx.outbox.effect({
      type: 'sendMessage',
      heroId: record.id,
      text: `The branch you build on, ${base.branch}, has moved on, and rebasing onto it conflicts. Run \`git rebase ${base.branch}\`, resolve the conflicts, run the tests, commit, and carry on with your task.`,
      priority: 'next',
    });
  }

  /** The campaign's cap (§14.3): when everyone together reaches it, every working hero stops and asks. */
  checkCap(): void {
    const state = this.ctx.state;
    const cap = state.settings.campaignBudgetMicroUsd;
    if (cap === null || state.campaign?.status !== 'active') return;
    if (this.total() < cap) return;
    for (const record of state.heroes) {
      const island = state.islands.find((i) => i.id === record.islandId);
      if (!island?.launched || record.submitted || record.outOfGold) continue;
      new Hero({ record, ctx: this.ctx }).stopForCampaign(cap);
    }
  }

  raiseCap(command: Extract<Command, { type: 'raiseCampaignBudget' }>): void {
    const settings = this.ctx.state.settings;
    if (settings.campaignBudgetMicroUsd === null) {
      this.ctx.outbox.reject(command.commandId, 'This campaign has no cap.');
      return;
    }
    this.ctx.state.settings = {
      ...settings,
      campaignBudgetMicroUsd: settings.campaignBudgetMicroUsd + command.addMicroUsd,
    };
    if (this.total() >= (this.ctx.state.settings.campaignBudgetMicroUsd ?? 0)) return;
    for (const record of this.ctx.state.heroes) {
      if (record.campaignCapped) new Hero({ record, ctx: this.ctx }).releaseCampaignCap();
    }
  }

  /**
   * Everything known to be spent: heroes, the elder and every sitting. A hero that hasn't reported yet
   * (or hasn't started) counts as nothing spent, so one silent hero can't keep the cap from tripping.
   */
  private total(): number {
    const state = this.ctx.state;
    const sittings = [...state.pastSittings, ...(state.sitting ? [state.sitting] : [])];
    return [...state.heroes, ...(state.elder ? [state.elder] : []), ...sittings].reduce(
      (sum, { gold }) => sum + (gold.kind === 'unknown' ? 0 : gold.value),
      0,
    );
  }
}

/** A branch name not yet used in this campaign: `-2`, `-3`… (git-level clashes are the game master's). */
function unique({ branch, taken }: { branch: string; taken: Set<string> }): string {
  let name = branch;
  for (let n = 2; taken.has(name); n++) name = `${branch}-${n}`;
  taken.add(name);
  return name;
}
