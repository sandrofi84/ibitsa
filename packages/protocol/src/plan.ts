import * as v from 'valibot';
import { type Branching, type Island, type Plan, PlanSchema, type PlanTask } from './plan.schema';

/**
 * Checks a plan from the council (spec §4.5): the schema, then its references — unique ids, tasks that
 * depend on tasks that exist without a cycle, decisions that exist, and councillors on the roster (or
 * the elder). Problems are short lines the council can act on.
 */
export function checkPlan({
  input,
  roster,
}: {
  input: unknown;
  roster: readonly string[];
}): { ok: true; plan: Plan } | { ok: false; problems: string[] } {
  const parsed = v.safeParse(PlanSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.issues.map((issue) => {
        const path = v.getDotPath(issue);
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const plan = parsed.output;
  const problems: string[] = [];
  const taskIds = plan.tasks.map((t) => t.id);
  const decisionIds = plan.decisions.map((d) => d.id);
  const seats = new Set([...roster, 'elder']);
  for (const id of duplicates(taskIds)) problems.push(`Task ${id} appears more than once.`);
  for (const id of duplicates(decisionIds)) problems.push(`Decision ${id} appears more than once.`);
  for (const task of plan.tasks) {
    for (const dep of task.dependsOn) {
      if (!taskIds.includes(dep))
        problems.push(`${task.id} depends on ${dep}, which isn't a task.`);
    }
    for (const d of task.decisions) {
      if (!decisionIds.includes(d))
        problems.push(`${task.id} refers to ${d}, which isn't a decision.`);
    }
    for (const c of task.criteria) {
      if (!roster.includes(c.councillorId)) {
        problems.push(`${task.id} has criteria for ${c.councillorId}, who isn't on the roster.`);
      }
    }
  }
  for (const d of plan.decisions) {
    if (!seats.has(d.raisedBy))
      problems.push(`${d.id} was raised by ${d.raisedBy}, who isn't at the table.`);
    for (const t of d.affects) {
      if (!taskIds.includes(t)) problems.push(`${d.id} affects ${t}, which isn't a task.`);
    }
    if (d.supersedes !== undefined && !decisionIds.includes(d.supersedes)) {
      problems.push(`${d.id} supersedes ${d.supersedes}, which isn't a decision.`);
    }
  }
  if (problems.length === 0 && taskOrder(plan.tasks) === null) {
    problems.push('The tasks depend on each other in a circle.');
  }
  if (problems.length === 0) problems.push(...islandProblems(plan));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plan };
}

/**
 * The plan's islands and branching (#120): as the plan gives them, or, for a plan without islands, one
 * island with every task in order, separate.
 */
export function planIslands(plan: Plan): { islands: Island[]; branching: Branching } {
  if (plan.islands) return { islands: plan.islands, branching: plan.branching ?? 'separate' };
  const tasks = (taskOrder(plan.tasks) ?? plan.tasks).map((t) => t.id);
  return { islands: [{ id: 'I1', title: plan.goal, tasks }], branching: 'separate' };
}

/**
 * Islands that hold together (§5.3): every task on exactly one island; each island's order keeps its
 * own dependencies; in a stacked plan a task depends only on its own or earlier islands; in a separate
 * plan the islands don't wait on each other in a circle.
 */
function islandProblems(plan: Plan): string[] {
  if (!plan.islands) return plan.branching ? ['A plan with branching needs islands.'] : [];
  const { islands, branching } = planIslands(plan);
  const problems: string[] = [];
  for (const id of duplicates(islands.map((i) => i.id)))
    problems.push(`Island ${id} appears more than once.`);
  const islandOf = new Map<string, string>();
  for (const island of islands) {
    for (const t of island.tasks) {
      if (!plan.tasks.some((task) => task.id === t))
        problems.push(`${island.id} has ${t}, which isn't a task.`);
      else if (islandOf.has(t))
        problems.push(`${t} is on both ${islandOf.get(t)} and ${island.id}.`);
      else islandOf.set(t, island.id);
    }
  }
  for (const task of plan.tasks) {
    if (!islandOf.has(task.id)) problems.push(`${task.id} isn't on any island.`);
  }
  if (problems.length > 0) return problems;
  const index = new Map(islands.map((island, i) => [island.id, i]));
  const waits = new Map<string, Set<string>>(islands.map((i) => [i.id, new Set<string>()]));
  for (const task of plan.tasks) {
    const home = islandOf.get(task.id) ?? '';
    const order = islands[index.get(home) ?? 0]?.tasks ?? [];
    for (const dep of task.dependsOn) {
      const there = islandOf.get(dep) ?? '';
      if (there === home) {
        if (order.indexOf(dep) > order.indexOf(task.id)) {
          problems.push(`On ${home}, ${task.id} comes before ${dep}, which it depends on.`);
        }
      } else if (branching === 'stacked' && (index.get(there) ?? 0) > (index.get(home) ?? 0)) {
        problems.push(
          `${task.id} on ${home} depends on ${dep} on ${there}, a later island in the stack.`,
        );
      } else waits.get(home)?.add(there);
    }
  }
  if (problems.length === 0 && branching === 'separate' && circular(waits)) {
    problems.push('The islands wait on each other in a circle.');
  }
  return problems;
}

/** Whether some island, following what it waits on, comes back to itself. */
function circular(waits: Map<string, Set<string>>): boolean {
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    const found = [...(waits.get(id) ?? [])].some(visit);
    visiting.delete(id);
    done.add(id);
    return found;
  };
  return [...waits.keys()].some(visit);
}

/**
 * The order a single hero works the tasks in (spec §14.2): each after the tasks it depends on, otherwise
 * as listed. Null when they depend on each other in a circle.
 */
export function taskOrder(tasks: readonly PlanTask[]): PlanTask[] | null {
  const done = new Set<string>();
  const order: PlanTask[] = [];
  while (order.length < tasks.length) {
    const next = tasks.find((t) => !done.has(t.id) && t.dependsOn.every((d) => done.has(d)));
    if (!next) return null;
    done.add(next.id);
    order.push(next);
  }
  return order;
}

function duplicates(ids: string[]): string[] {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}
