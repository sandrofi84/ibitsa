import * as v from 'valibot';

// User intents sent by front ends. Validated at core because they cross a trust boundary and can
// approve tool runs (spec §11.2.1). Strict objects: unknown fields are rejected, not ignored.

const id = v.pipe(v.string(), v.nonEmpty());
const positiveInt = v.pipe(v.number(), v.integer(), v.minValue(1));

/** Light, Standard or Deep: models and caps for a councillor or a sitting (spec §4.2). */
export const EffortSchema = v.picklist(['light', 'standard', 'deep']);
export type Effort = v.InferOutput<typeof EffortSchema>;

/** Round table: one session voices every councillor. Separate chambers: each councillor apart (§4.3). */
export const SittingModeSchema = v.picklist(['roundTable', 'chambers']);
export type SittingMode = v.InferOutput<typeof SittingModeSchema>;

/** The user's answer to one council question: an option, or their own words (§4.4). */
export const CouncilAnswerSchema = v.union([
  v.strictObject({ optionId: id }),
  v.strictObject({ text: v.pipe(v.string(), v.trim(), v.nonEmpty()) }),
]);
export type CouncilAnswer = v.InferOutput<typeof CouncilAnswerSchema>;

export const CommandSchema = v.variant('type', [
  v.strictObject({ type: v.literal('hello'), protocolVersion: positiveInt }),
  /** A page of the journal, answered by the runtime and never logged (#58): `before` an entry index. */
  v.strictObject({
    type: v.literal('requestJournal'),
    before: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(500))),
  }),
  v.strictObject({
    type: v.literal('sendMessage'),
    commandId: id,
    heroId: id,
    text: v.pipe(v.string(), v.nonEmpty()),
    priority: v.picklist(['now', 'next']),
  }),
  /** Interrupt and clear the adapter's queue. */
  v.strictObject({ type: v.literal('stopHero'), commandId: id, heroId: id }),
  /** Rest: compact the hero's session to free context (§6.3, #82). */
  v.strictObject({ type: v.literal('restHero'), commandId: id, heroId: id }),
  v.strictObject({
    type: v.literal('answerPermission'),
    commandId: id,
    itemId: id,
    decision: v.picklist(['allow', 'deny']),
    note: v.optional(v.string()),
    /** Also allow the request's suggested rules from now on: for this quest, or for the project (#62). */
    always: v.optional(v.picklist(['quest', 'project'])),
  }),
  /** Auto mode for the running quest (#63): logged, so a replay shows when it changed. */
  v.strictObject({ type: v.literal('setAutoApprove'), commandId: id, on: v.boolean() }),
  /** The files in an island's worktree, for @ file references (#83). Runtime-only, never logged. */
  v.strictObject({ type: v.literal('requestFiles'), islandId: id }),
  /** An action's expanded prompt, for the preview (#85). Runtime-only, never logged. */
  v.strictObject({
    type: v.literal('requestPreview'),
    name: v.pipe(v.string(), v.nonEmpty()),
    args: v.string(),
  }),
  /** Writes a new action as a Claude Code skill (#86). Runtime-only, never logged. */
  v.strictObject({
    type: v.literal('createAction'),
    name: v.pipe(v.string(), v.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), v.maxLength(64)),
    description: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(300)),
    argumentHint: v.pipe(v.string(), v.trim(), v.maxLength(100)),
    prompt: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20_000)),
    target: v.picklist(['hero', 'any']),
    scope: v.picklist(['personal', 'project']),
    overwrite: v.optional(v.boolean()),
  }),
  /** The `/` menu's actions (#84). Runtime-only, never logged. */
  v.strictObject({ type: v.literal('requestActions') }),
  /** Removes an "Always allow in this project" rule. Runtime-only, never logged (#62). */
  v.strictObject({ type: v.literal('forgetProjectRule'), rule: v.pipe(v.string(), v.nonEmpty()) }),
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
  /**
   * Convene the council (spec §4.2). `effort` is the sitting's; in separate chambers every councillor on
   * the roster also needs one in `councillorEfforts`.
   */
  v.strictObject({
    type: v.literal('conveneCouncil'),
    commandId: id,
    task: v.pipe(v.string(), v.nonEmpty()),
    mode: SittingModeSchema,
    roster: v.pipe(v.array(id), v.minLength(1)),
    effort: EffortSchema,
    councillorEfforts: v.optional(v.record(id, EffortSchema)),
  }),
  /** Add a councillor mid-sitting; it must report before the next plan is accepted. */
  v.strictObject({
    type: v.literal('addCouncillor'),
    commandId: id,
    councillorId: id,
    effort: EffortSchema,
  }),
  /** Answers the waiting `ask_user` batch, one answer per question id. */
  v.strictObject({
    type: v.literal('answerCouncil'),
    commandId: id,
    batchId: id,
    answers: v.record(id, CouncilAnswerSchema),
  }),
  /**
   * "Why?" on a waiting question (spec §4.4): the councillor who asked explains, through the sitting's
   * lead session. `text` is the user's own follow-up; without it the councillor is just asked why.
   */
  v.strictObject({
    type: v.literal('askCouncilWhy'),
    commandId: id,
    batchId: id,
    questionId: id,
    text: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())),
  }),
  v.strictObject({ type: v.literal('approvePlan'), commandId: id, version: positiveInt }),
  v.strictObject({
    type: v.literal('requestPlanChange'),
    commandId: id,
    version: positiveInt,
    text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  }),
  v.strictObject({ type: v.literal('dismissCouncil'), commandId: id }),
  /** Refused unless the worktree is clean. */
  v.strictObject({ type: v.literal('removeWorktree'), commandId: id, islandId: id }),
]);

export type Command = v.InferOutput<typeof CommandSchema>;
