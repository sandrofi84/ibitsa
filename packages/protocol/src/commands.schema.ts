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
  /** The Guild Hall's Chronicle (#179): past campaigns, answered by the runtime and never logged. */
  v.strictObject({ type: v.literal('requestChronicle') }),
  /**
   * Carry out the approved plan with a party per island (§5.1, §5.3, #121): each island's hero and gold
   * cap from party assembly, the base branch, and for a stacked plan how its islands start.
   */
  v.strictObject({
    type: v.literal('startCampaign'),
    commandId: id,
    baseRef: id,
    stackedStart: v.optional(v.picklist(['cleared', 'together'])),
    parties: v.pipe(
      v.array(
        v.strictObject({
          islandId: id,
          heroName: v.pipe(v.string(), v.nonEmpty()),
          classId: id,
          /** Overrides the default gold pouch; null for none. */
          budgetMicroUsd: v.optional(v.nullable(positiveInt)),
          /** Review effort per reviewing councillor (§5.5, M5); Light when absent. */
          reviewEfforts: v.optional(v.record(id, EffortSchema)),
        }),
      ),
      v.minLength(1),
    ),
  }),
  /**
   * Settles an escalated review (§5.5, #136): accept the task anyway, send it back with a note, or stop
   * the hero.
   */
  v.strictObject({
    type: v.literal('resolveReview'),
    commandId: id,
    itemId: id,
    decision: v.picklist(['accept', 'sendBack', 'stop']),
    note: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())),
  }),
  /** Settles the hero's dispute: drop the disputed findings, or keep them (with an optional note). */
  v.strictObject({
    type: v.literal('resolveDispute'),
    commandId: id,
    itemId: id,
    decision: v.picklist(['drop', 'keep']),
    note: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty())),
  }),
  /** Clears a "Revisit D…?" item: the decision stands (to change it, talk to the council). */
  v.strictObject({ type: v.literal('dismissItem'), commandId: id, itemId: id }),
  /** Raise the campaign's cap (§14.3): heroes it stopped carry on if the total is below it again. */
  v.strictObject({
    type: v.literal('raiseCampaignBudget'),
    commandId: id,
    addMicroUsd: positiveInt,
  }),
  /** Ask the elder to research a task (spec §4.1): starts a campaign in planning. */
  v.strictObject({
    type: v.literal('consultElder'),
    commandId: id,
    task: v.pipe(v.string(), v.trim(), v.nonEmpty()),
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
    /** Whose worktree to expand it in (#125); the first hero's without one. */
    heroId: v.optional(id),
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
  /** The `/` menu's actions (#84), for a hero's worktree (#125). Runtime-only, never logged. */
  v.strictObject({ type: v.literal('requestActions'), heroId: v.optional(id) }),
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
    /** Convened the other way, to compare with this earlier sitting (§4.10). */
    comparisonOf: v.optional(id),
    /** A council's context was kept (§4.9) but this sitting starts fresh, forgetting it (#168). */
    freshCouncil: v.optional(v.boolean()),
  }),
  /** "How useful was the council?" (§4.10): 1–5 and an optional note, once the sitting has ended. */
  v.strictObject({
    type: v.literal('rateSitting'),
    commandId: id,
    sittingId: id,
    score: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(5)),
    note: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(500))),
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
  /**
   * Talk to the council mid-campaign (§4.8, #169): `@council`, `@<councillor id>` or the hut. The
   * approved sitting's lead session answers; heroes keep working.
   */
  v.strictObject({
    type: v.literal('consultCouncil'),
    commandId: id,
    text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
    councillorId: v.optional(id),
  }),
  v.strictObject({
    type: v.literal('requestPlanChange'),
    commandId: id,
    version: positiveInt,
    text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  }),
  /** Approve Amendment `number` (§4.8, #170): it changes the plan and the islands. */
  v.strictObject({ type: v.literal('approveAmendment'), commandId: id, number: positiveInt }),
  /** Send Amendment `number` back to the council with a note; it proposes again. */
  v.strictObject({
    type: v.literal('requestAmendmentChange'),
    commandId: id,
    number: positiveInt,
    text: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  }),
  /** Drop Amendment `number`: the plan stays as it is. */
  v.strictObject({ type: v.literal('discardAmendment'), commandId: id, number: positiveInt }),
  /** The party of an island an amendment added (#170): its hero, gold cap and review efforts. */
  v.strictObject({
    type: v.literal('assembleParty'),
    commandId: id,
    islandId: id,
    heroName: v.pipe(v.string(), v.nonEmpty()),
    classId: id,
    budgetMicroUsd: v.optional(v.nullable(positiveInt)),
    reviewEfforts: v.optional(v.record(id, EffortSchema)),
  }),
  v.strictObject({ type: v.literal('dismissCouncil'), commandId: id }),
  /** Refused unless the worktree is clean. */
  v.strictObject({ type: v.literal('removeWorktree'), commandId: id, islandId: id }),
  /** Push the island's branch and open its PR (§5.6): a draft before the island is cleared. */
  v.strictObject({
    type: v.literal('openPullRequest'),
    commandId: id,
    islandId: id,
    title: v.pipe(v.string(), v.trim(), v.nonEmpty()),
    body: v.string(),
    draft: v.boolean(),
  }),
  /** Push what's new to the island's open PR. */
  v.strictObject({ type: v.literal('updatePullRequest'), commandId: id, islandId: id }),
  /** Push, then turn the draft into a PR ready for review: once the island is cleared. */
  v.strictObject({ type: v.literal('markPullRequestReady'), commandId: id, islandId: id }),
  /** Poll the git host now rather than at the next interval. */
  v.strictObject({ type: v.literal('refreshPullRequests'), commandId: id }),
  /** Fetch the PR's review comments and send them to the island's hero (#154). */
  v.strictObject({ type: v.literal('bringPullRequestComments'), commandId: id, islandId: id }),
  /** Stacked, after the island it built on merged: move the branch onto that island's base (#154). */
  v.strictObject({ type: v.literal('restackIsland'), commandId: id, islandId: id }),
  /** After Finish (§4.9, #167): what happens to the council's context. */
  v.strictObject({
    type: v.literal('chooseCouncilContext'),
    commandId: id,
    choice: v.picklist(['empty', 'compact', 'keep']),
  }),
  /** Push the island's branch without a PR, to any remote. */
  v.strictObject({ type: v.literal('pushBranch'), commandId: id, islandId: id }),
]);

export type Command = v.InferOutput<typeof CommandSchema>;
