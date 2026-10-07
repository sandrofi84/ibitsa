import * as v from 'valibot';

// The plan the council proposes with `propose_plan` (spec §4.5, #104). It comes from a model, so core
// checks it (schema and references, `checkPlan`) before the user sees it.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const taskId = v.pipe(v.string(), v.regex(/^T\d+$/, 'Task ids look like T1, T2, …'));
const decisionId = v.pipe(v.string(), v.regex(/^D\d+$/, 'Decision ids look like D1, D2, …'));

export const PlanTaskSchema = v.strictObject({
  id: taskId,
  title: text,
  /** What the hero is told to do. */
  description: text,
  /** Files likely touched, so the hero needn't explore (spec §10 rule 2). */
  files: v.pipe(v.array(text), v.maxLength(30)),
  dependsOn: v.array(taskId),
  /** A suggested hero class (§5.2). */
  heroClass: v.optional(v.picklist(['paladin', 'barbarian', 'ranger', 'rogue'])),
  /** Acceptance criteria per reviewing councillor. */
  criteria: v.array(
    v.strictObject({ councillorId: text, items: v.pipe(v.array(text), v.minLength(1)) }),
  ),
  /** Decisions this task depends on. */
  decisions: v.array(decisionId),
});
export type PlanTask = v.InferOutput<typeof PlanTaskSchema>;

/** A recorded user choice (§4.5): what was chosen, what wasn't and why. */
export const DecisionSchema = v.strictObject({
  id: decisionId,
  title: text,
  /** The councillor who raised it, or `elder`. */
  raisedBy: text,
  chosen: text,
  alternatives: v.array(v.strictObject({ option: text, rejectedBecause: text })),
  tradeoffs: v.optional(text),
  /** The user's reason, in their words when they gave one. */
  why: text,
  /** A 2–3 line summary of the discussion; never a transcript. */
  discussion: v.optional(text),
  affects: v.array(taskId),
  supersedes: v.optional(decisionId),
});
export type Decision = v.InferOutput<typeof DecisionSchema>;

/** One worktree and one party (§5.1, #120): its tasks, in the order its hero works them. */
export const IslandSchema = v.strictObject({
  id: v.pipe(v.string(), v.regex(/^I\d+$/, 'Island ids look like I1, I2, …')),
  title: text,
  tasks: v.pipe(v.array(taskId), v.minLength(1)),
});
export type Island = v.InferOutput<typeof IslandSchema>;

/** Separate: every island branches from the base. Stacked: each from the island listed before it (§5.3). */
export const BranchingSchema = v.picklist(['separate', 'stacked']);
export type Branching = v.InferOutput<typeof BranchingSchema>;

export const PlanSchema = v.strictObject({
  /** The plan in a sentence or two. */
  summary: text,
  goal: text,
  scope: v.optional(text),
  tasks: v.pipe(v.array(PlanTaskSchema), v.minLength(1), v.maxLength(20)),
  /** The Book of Decisions. */
  decisions: v.array(DecisionSchema),
  /** How the tasks split into worktrees (#120). Without it, one island holds every task. */
  islands: v.optional(v.pipe(v.array(IslandSchema), v.minLength(1), v.maxLength(8))),
  branching: v.optional(BranchingSchema),
});
export type Plan = v.InferOutput<typeof PlanSchema>;
