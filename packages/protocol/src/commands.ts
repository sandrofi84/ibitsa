import * as v from 'valibot';

// User intents sent by front ends. Validated at core because they cross a trust boundary and can
// approve tool runs (spec §11.2.1). Strict objects: unknown fields are rejected, not ignored.

const id = v.pipe(v.string(), v.nonEmpty());
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

export const CommandSchema = v.variant('type', [
  v.strictObject({ type: v.literal('hello'), protocolVersion: positiveInt }),
  v.strictObject({
    type: v.literal('sendMessage'),
    commandId: id,
    heroId: id,
    text: v.pipe(v.string(), v.nonEmpty()),
    priority: v.picklist(['now', 'next']),
  }),
  /** Interrupt and clear the adapter's queue. */
  v.strictObject({ type: v.literal('stopHero'), commandId: id, heroId: id }),
  v.strictObject({
    type: v.literal('answerPermission'),
    commandId: id,
    itemId: id,
    decision: v.picklist(['allow', 'deny']),
    note: v.optional(v.string()),
  }),
  v.strictObject({
    type: v.literal('answerQuestion'),
    commandId: id,
    itemId: id,
    answers: v.record(v.string(), v.union([v.string(), v.array(v.string())])),
  }),
  /** Continue after a stall, retry after an error, or resume after a window reload. */
  v.strictObject({ type: v.literal('resumeHero'), commandId: id, heroId: id }),
  v.strictObject({
    type: v.literal('raiseBudget'),
    commandId: id,
    heroId: id,
    addMicroUsd: positiveInt,
  }),
  /** The user marks the task submitted (for agents without custom tools, §5.4). */
  v.strictObject({ type: v.literal('markDone'), commandId: id, heroId: id }),
  /** M1 quick quest (§14.1). */
  v.strictObject({
    type: v.literal('startQuest'),
    commandId: id,
    description: v.pipe(v.string(), v.nonEmpty()),
    heroName: v.pipe(v.string(), v.trim(), v.nonEmpty()),
    classId: id,
    baseRef: id,
  }),
  v.strictObject({ type: v.literal('finishQuest'), commandId: id }),
  v.strictObject({ type: v.literal('abandonQuest'), commandId: id }),
  /** Refused unless the worktree is clean. */
  v.strictObject({ type: v.literal('removeWorktree'), commandId: id, islandId: id }),
]);

export type Command = v.InferOutput<typeof CommandSchema>;

export type ParseCommandResult = { ok: true; command: Command } | { ok: false; issues: string[] };

export function parseCommand(input: unknown): ParseCommandResult {
  const result = v.safeParse(CommandSchema, input);
  if (result.success) return { ok: true, command: result.output };
  return {
    ok: false,
    issues: result.issues.map((issue) => {
      const path = v.getDotPath(issue);
      return path ? `${path}: ${issue.message}` : issue.message;
    }),
  };
}
