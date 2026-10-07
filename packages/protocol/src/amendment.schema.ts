import * as v from 'valibot';
import { DecisionSchema, IslandSchema, PlanTaskSchema } from './plan.schema';

// A change to the approved plan mid-campaign (spec §4.8, #170): it comes from a model, so core checks
// it (`checkAmendment`) before the user sees it. Only work not started may change; rework is a new task.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const taskId = v.pipe(v.string(), v.regex(/^T\d+$/, 'Task ids look like T1, T2, …'));
const islandId = v.pipe(v.string(), v.regex(/^I\d+$/, 'Island ids look like I1, I2, …'));

export const AmendmentSchema = v.strictObject({
  /** What changes and why, in a sentence or two. */
  summary: text,
  /** New tasks (new ids), and new versions of tasks not started yet (their own ids). */
  tasks: v.pipe(v.array(PlanTaskSchema), v.maxLength(20)),
  /** Tasks not started yet to drop. */
  removeTasks: v.array(taskId),
  /** New tasks added to the end of an existing island, in order. */
  addToIslands: v.array(
    v.strictObject({ islandId, tasks: v.pipe(v.array(taskId), v.minLength(1)) }),
  ),
  /** New islands with their new tasks, after the existing ones; each gets its own party. */
  islands: v.pipe(v.array(IslandSchema), v.maxLength(4)),
  /** New decisions for the Book of Decisions. */
  decisions: v.array(DecisionSchema),
});
export type Amendment = v.InferOutput<typeof AmendmentSchema>;
