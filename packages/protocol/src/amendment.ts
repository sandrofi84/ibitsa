import * as v from 'valibot';
import { type Amendment, AmendmentSchema } from './amendment.schema';
import type { AmendmentChange } from './amendment.types';
import { checkPlan, planIslands } from './plan';
import type { Plan } from './plan.schema';

/**
 * The plan with an amendment applied (#170): edited tasks replaced, removed tasks gone (from their
 * islands too), new tasks added to the end of their islands, new islands after the existing ones, and
 * new decisions added. The result always lists its islands.
 */
export function applyAmendment({ plan, amendment }: { plan: Plan; amendment: Amendment }): Plan {
  const { islands, branching } = planIslands(plan);
  const removed = new Set(amendment.removeTasks);
  const edits = new Map(amendment.tasks.map((t) => [t.id, t]));
  const known = new Set(plan.tasks.map((t) => t.id));
  const tasks = [
    ...plan.tasks.filter((t) => !removed.has(t.id)).map((t) => edits.get(t.id) ?? t),
    ...amendment.tasks.filter((t) => !known.has(t.id)),
  ];
  const added = new Map(amendment.addToIslands.map((a) => [a.islandId, a.tasks]));
  return {
    ...plan,
    tasks,
    decisions: [...plan.decisions, ...amendment.decisions],
    islands: [
      ...islands.map((island) => ({
        ...island,
        tasks: [...island.tasks.filter((t) => !removed.has(t)), ...(added.get(island.id) ?? [])],
      })),
      ...amendment.islands,
    ],
    branching,
  };
}

/**
 * Checks an amendment from the council against the plan it changes (§4.8): the schema; that it changes
 * something; that tasks already started (`started`, plan task ids) are neither edited nor removed,
 * since rework is a new task; that it adds to islands that exist; then the amended plan as a whole
 * (`checkPlan`: ids, dependencies, decisions, criteria on the roster, islands).
 */
export function checkAmendment({
  input,
  plan,
  roster,
  started,
}: {
  input: unknown;
  plan: Plan;
  roster: readonly string[];
  started: readonly string[];
}): { ok: true; amendment: Amendment; plan: Plan } | { ok: false; problems: string[] } {
  const parsed = v.safeParse(AmendmentSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.issues.map((issue) => {
        const path = v.getDotPath(issue);
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const amendment = parsed.output;
  const problems: string[] = [];
  const known = new Set(plan.tasks.map((t) => t.id));
  const islandIds = new Set(planIslands(plan).islands.map((i) => i.id));
  const isStarted = new Set(started);
  if (
    amendment.tasks.length === 0 &&
    amendment.removeTasks.length === 0 &&
    amendment.decisions.length === 0
  ) {
    problems.push('The amendment changes nothing.');
  }
  for (const t of amendment.tasks) {
    if (known.has(t.id) && isStarted.has(t.id))
      problems.push(`${t.id} has started, so it can't change: rework is a new task.`);
  }
  for (const id of amendment.removeTasks) {
    if (!known.has(id)) problems.push(`${id} isn't a task, so it can't be removed.`);
    else if (isStarted.has(id)) problems.push(`${id} has started, so it can't be removed.`);
    if (amendment.tasks.some((t) => t.id === id))
      problems.push(`${id} is both edited and removed.`);
  }
  for (const a of amendment.addToIslands) {
    if (!islandIds.has(a.islandId)) problems.push(`${a.islandId} isn't an island of the plan.`);
  }
  if (problems.length > 0) return { ok: false, problems };
  const checked = checkPlan({ input: applyAmendment({ plan, amendment }), roster });
  return checked.ok
    ? { ok: true, amendment, plan: checked.plan }
    : { ok: false, problems: checked.problems };
}

/** What an amendment changes, in its own order, for the plan review's change set (#170). */
export function amendmentChanges({
  plan,
  amendment,
}: {
  plan: Plan;
  amendment: Amendment;
}): AmendmentChange[] {
  const amended = applyAmendment({ plan, amendment });
  const islands = amended.islands ?? [];
  const before = planIslands(plan).islands;
  const islandOf = (taskId: string) =>
    (islands.find((i) => i.tasks.includes(taskId)) ?? before.find((i) => i.tasks.includes(taskId)))
      ?.title ?? '';
  const old = new Map(plan.tasks.map((t) => [t.id, t]));
  const changes: AmendmentChange[] = [];
  for (const t of amendment.tasks) {
    const was = old.get(t.id);
    changes.push(
      was
        ? {
            kind: 'edited',
            taskId: t.id,
            title: t.title,
            before: was.title,
            island: islandOf(t.id),
          }
        : { kind: 'added', taskId: t.id, title: t.title, island: islandOf(t.id) },
    );
  }
  for (const id of amendment.removeTasks) {
    changes.push({
      kind: 'removed',
      taskId: id,
      title: old.get(id)?.title ?? id,
      island: islandOf(id),
    });
  }
  for (const island of amendment.islands) {
    changes.push({ kind: 'island', islandId: island.id, title: island.title, tasks: island.tasks });
  }
  for (const d of amendment.decisions) {
    changes.push({ kind: 'decision', decisionId: d.id, title: d.title });
  }
  return changes;
}
