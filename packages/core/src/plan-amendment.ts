import type {
  Amendment,
  AmendmentView,
  Command,
  CouncilEvent,
  Plan,
  PlanTask,
} from '@ibitsa/protocol';
import {
  amendmentChanges,
  applyAmendment,
  checkAmendment,
  planIslands,
  taskOrder,
} from '@ibitsa/protocol';
import { Campaign } from './campaign';
import { Consultation } from './consultation';
import { Hero } from './hero';
import { Quest } from './quest';
import { newId } from './state';
import type { AmendmentRecord, CoreState, Island, SittingRecord } from './state.types';
import type { StepContext } from './step.types';

const STARTED = new Set(['active', 'underReview', 'done', 'doneUnreviewed']);

/**
 * Changes to the approved plan mid-campaign (spec §4.8, #170). The council proposes one with
 * `propose_amendment` while it answers a question; core checks it against what has started (only work
 * not started may change: rework is a new task) and the user approves, sends back or discards it. An
 * approved amendment changes the islands' task points, adds islands that wait for their party, tells
 * the heroes it affects, and stays on the sitting, so the approved plan (`Sitting.approvedPlan`) is
 * always the plan with its approved amendments applied.
 */
export class PlanAmendment {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** The approved plan of a sitting with its approved amendments applied; none before approval. */
  static amended(record: SittingRecord): Plan | undefined {
    const plan = record.plans.filter((p) => p.outcome.kind === 'approved').at(-1)?.plan;
    if (!plan) return undefined;
    return (record.amendments ?? [])
      .filter((a) => a.outcome.kind === 'approved')
      .reduce((p, a) => applyAmendment({ plan: p, amendment: a.amendment }), plan);
  }

  /** Each amendment with its change set against the plan as it stood when it came. */
  static views(record: SittingRecord): AmendmentView[] {
    let plan = record.plans.filter((p) => p.outcome.kind === 'approved').at(-1)?.plan;
    if (!plan) return [];
    const views: AmendmentView[] = [];
    for (const a of record.amendments ?? []) {
      views.push({
        number: a.number,
        amendment: a.amendment,
        changes: amendmentChanges({ plan, amendment: a.amendment }),
        outcome: a.outcome,
      });
      if (a.outcome.kind === 'approved') plan = applyAmendment({ plan, amendment: a.amendment });
    }
    return views;
  }

  /** The plan tasks that have started: past `locked`, or a hero's current task (held, #121). */
  static started(state: CoreState): string[] {
    const current = new Set(state.heroes.map((h) => h.taskPointId));
    return state.islands.flatMap((i) =>
      i.taskPoints.flatMap((tp) =>
        tp.planTaskId && (STARTED.has(tp.state) || current.has(tp.id)) ? [tp.planTaskId] : [],
      ),
    );
  }

  /** `propose_amendment` while the council answers a question: checked, then kept for the user. */
  propose({
    record,
    event,
  }: {
    record: SittingRecord;
    event: Extract<CouncilEvent, { type: 'amendmentProposed' }>;
  }): void {
    const plan = PlanAmendment.amended(record);
    const checked = plan
      ? checkAmendment({
          input: event.amendment,
          plan,
          roster: record.roster.map((c) => c.councillorId),
          started: PlanAmendment.started(this.ctx.state),
        })
      : { ok: false as const, problems: ['There is no approved plan to amend.'] };
    if (!checked.ok) {
      this.complete({
        record,
        toolUseId: event.toolUseId,
        reason: `The amendment can't be accepted:\n${checked.problems.map((p) => `- ${p}`).join('\n')}`,
      });
      return;
    }
    const amendments = record.amendments ?? [];
    for (const a of amendments)
      if (a.outcome.kind === 'proposed') a.outcome = { kind: 'superseded' };
    record.amendments = [
      ...amendments,
      {
        number: amendments.length + 1,
        amendment: checked.amendment,
        outcome: { kind: 'proposed' },
      },
    ];
    this.complete({ record, toolUseId: event.toolUseId });
  }

  approve(command: Extract<Command, { type: 'approveAmendment' }>): void {
    const found = this.waiting(command);
    if (!found) return;
    const { record, entry } = found;
    const state = this.ctx.state;
    const before = PlanAmendment.amended(record);
    // Work may have started since it was proposed: it's checked again against the islands as they are.
    const checked = before
      ? checkAmendment({
          input: entry.amendment,
          plan: before,
          roster: record.roster.map((c) => c.councillorId),
          started: PlanAmendment.started(state),
        })
      : { ok: false as const, problems: ['There is no approved plan to amend.'] };
    if (!before || !checked.ok) {
      this.ctx.outbox.reject(
        command.commandId,
        `Since it was proposed: ${checked.ok ? '' : checked.problems.join(' ')}`.trim(),
      );
      return;
    }
    entry.outcome = { kind: 'approved' };
    this.apply({ before, after: checked.plan, amendment: entry });
    const version = record.plans.filter((p) => p.outcome.kind === 'approved').at(-1)?.version ?? 1;
    this.ctx.outbox.effect({
      type: 'saveAmendment',
      sittingId: record.id,
      version,
      plan: checked.plan,
      amendments: (record.amendments ?? [])
        .filter((a) => a.outcome.kind === 'approved')
        .map(({ number, amendment }) => ({ number, amendment })),
    });
  }

  /** Back to the council with a note: it's asked, like a question, to propose again. */
  requestChange(command: Extract<Command, { type: 'requestAmendmentChange' }>): void {
    const found = this.waiting(command);
    if (!found) return;
    const asked = new Consultation(this.ctx).followUp({
      commandId: command.commandId,
      line: `Amendment ${command.number}: ${command.text}`,
      prompt: `The user asked for changes to Amendment ${command.number}:\n${command.text}\n\nCall propose_amendment again with the whole amendment, changed as they ask; say briefly what you changed.`,
    });
    if (asked) found.entry.outcome = { kind: 'changeRequested', note: command.text };
  }

  discard(command: Extract<Command, { type: 'discardAmendment' }>): void {
    const found = this.waiting(command);
    if (found) found.entry.outcome = { kind: 'discarded' };
  }

  /** The party of an island an amendment added: once it has one, it waits for a slot like the rest. */
  assembleParty(command: Extract<Command, { type: 'assembleParty' }>): void {
    const state = this.ctx.state;
    const island = state.islands.find((i) => i.id === command.islandId);
    if (!island?.awaitingParty) {
      this.ctx.outbox.reject(command.commandId, 'That island already has its party.');
      return;
    }
    island.awaitingParty = false;
    if (command.reviewEfforts) island.reviewEfforts = command.reviewEfforts;
    Campaign.joinParty({ state, islandId: island.id, party: command });
  }

  private apply({
    before,
    after,
    amendment: { number, amendment },
  }: {
    before: Plan;
    after: Plan;
    amendment: AmendmentRecord;
  }): void {
    const state = this.ctx.state;
    const planIslandIds = planIslands(before).islands.map((i) => i.id);
    const islandFor = (planIslandId: string) =>
      state.islands.find(
        (i, k) => (i.planIslandId ?? planIslandIds[k]) === planIslandId && !i.worktreeRemoved,
      );
    const order = taskOrder(after.tasks) ?? after.tasks;
    const point = (task: PlanTask) => ({
      id: newId(state, 't'),
      title: task.title,
      description: task.description,
      briefing: Quest.briefing({
        plan: after,
        task,
        index: order.indexOf(task),
        total: order.length,
      }),
      state: 'locked' as const,
      planTaskId: task.id,
      dependsOn: task.dependsOn,
    });
    const tasks = new Map(after.tasks.map((t) => [t.id, t]));
    const touched = new Map<Island, string[]>();
    const note = ({ island, line }: { island: Island; line: string }) =>
      touched.set(island, [...(touched.get(island) ?? []), line]);
    const removed = new Set(amendment.removeTasks);
    for (const island of state.islands) {
      for (const tp of island.taskPoints) {
        if (!tp.planTaskId) continue;
        if (removed.has(tp.planTaskId)) note({ island, line: `removed "${tp.title}"` });
        const edit = amendment.tasks.find((t) => t.id === tp.planTaskId);
        if (!edit) continue;
        Object.assign(tp, { ...point(edit), id: tp.id });
        note({ island, line: `changed "${edit.title}"` });
      }
      island.taskPoints = island.taskPoints.filter((tp) => !removed.has(tp.planTaskId ?? ''));
    }
    const added: Island[] = [];
    for (const { islandId, tasks: ids } of amendment.addToIslands) {
      const island = islandFor(islandId);
      if (!island) continue;
      for (const id of ids) {
        const task = tasks.get(id);
        if (!task) continue;
        island.taskPoints.push(point(task));
        note({ island, line: `added "${task.title}"` });
      }
      added.push(island);
    }
    for (const planIsland of amendment.islands) this.addIsland({ planIsland, tasks, point });
    // A hero whose island was done gets the new work; the others hear what changed.
    for (const record of state.heroes) {
      const island = state.islands.find((i) => i.id === record.islandId);
      if (!island) continue;
      const hero = new Hero({ record, ctx: this.ctx });
      if (record.submitted && added.includes(island)) {
        const next = island.taskPoints.find((tp) => tp.state === 'locked');
        if (!next) continue;
        record.submitted = null;
        record.taskPointId = next.id;
        const unmet = Campaign.unmet({ state, taskPoint: next });
        if (unmet.length > 0) record.heldFor = unmet;
        else hero.takeNextTask();
        continue;
      }
      const lines = touched.get(island);
      if (!lines || record.submitted || !island.launched) continue;
      hero.tell(
        `The plan was amended (Amendment ${number}): ${amendment.summary}\nOn your island: ${lines.join('; ')}.\nCarry on with your current task; the changed tasks come to you in turn.`,
      );
    }
  }

  /** A new island after the others: it fans out (separate) or joins the end of the line (stacked). */
  private addIsland({
    planIsland,
    tasks,
    point,
  }: {
    planIsland: Amendment['islands'][number];
    tasks: Map<string, PlanTask>;
    point: (task: PlanTask) => Island['taskPoints'][number];
  }): void {
    const state = this.ctx.state;
    const stacked = state.campaign?.branching === 'stacked';
    const before = stacked ? state.islands.at(-1) : undefined;
    state.islands.push({
      id: newId(state, 'i'),
      name: planIsland.title,
      branch: Campaign.freeBranch({ state, title: planIsland.title }),
      baseRef: before ? before.branch : (state.campaign?.baseRef ?? 'main'),
      worktreePath: null,
      worktreeRemoved: false,
      launched: false,
      basedOn: before?.id ?? null,
      behind: false,
      taskPoints: planIsland.tasks.flatMap((id) => {
        const task = tasks.get(id);
        return task ? [point(task)] : [];
      }),
      planIslandId: planIsland.id,
      awaitingParty: true,
    });
  }

  /** The approved sitting's amendment the command names, if it's waiting for the user. */
  private waiting({ commandId, number }: { commandId: string; number: number }) {
    const record = this.ctx.state.sitting;
    const entry = record?.amendments?.find((a) => a.number === number);
    if (!record || record.status !== 'approved' || entry?.outcome.kind !== 'proposed') {
      this.ctx.outbox.reject(commandId, `Amendment ${number} isn't waiting for you.`);
      return undefined;
    }
    return { record, entry };
  }

  private complete({
    record,
    toolUseId,
    reason,
  }: {
    record: SittingRecord;
    toolUseId: string;
    reason?: string;
  }): void {
    this.ctx.outbox.effect({
      type: 'completeSittingTool',
      sittingId: record.id,
      toolUseId,
      accepted: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
