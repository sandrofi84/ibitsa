import * as v from 'valibot';
import { type Plan, PlanSchema, type PlanTask } from './plan.schema';

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
  return problems.length > 0 ? { ok: false, problems } : { ok: true, plan };
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
