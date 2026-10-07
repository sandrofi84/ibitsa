import * as v from 'valibot';
import { EffortSchema } from './commands.schema';

// The research brief the elder files with `submit_brief` (spec §4.1). It comes from a model, so the
// adapter validates it against this schema and hands the problems back to the elder to fix.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty());
const councillorId = v.pipe(v.string(), v.nonEmpty());

/** A place in the code: a path, optionally a line range like `40-120`, and why it matters. */
export const CodePointerSchema = v.strictObject({
  path: text,
  lines: v.optional(v.pipe(v.string(), v.regex(/^\d+(-\d+)?$/))),
  note: text,
});
export type CodePointer = v.InferOutput<typeof CodePointerSchema>;

export const ResearchBriefSchema = v.strictObject({
  /** The task in the elder's words. */
  task: text,
  /** Relevant files and areas, one line each. */
  files: v.pipe(v.array(CodePointerSchema), v.maxLength(40)),
  /** Patterns, conventions, risks and unknowns every councillor should know. */
  findings: v.pipe(v.array(text), v.maxLength(20)),
  /** For each recommended councillor, what in this task touches its field: pointers, not file contents. */
  slices: v.array(
    v.strictObject({
      councillorId,
      summary: text,
      pointers: v.pipe(v.array(CodePointerSchema), v.maxLength(20)),
    }),
  ),
  /** Who should sit, and why. */
  councillors: v.array(v.strictObject({ councillorId, reason: text })),
  /** Effort for a round table. */
  effort: v.strictObject({ level: EffortSchema, reason: text }),
  /** Effort per councillor, for separate chambers. */
  councillorEfforts: v.array(v.strictObject({ councillorId, level: EffortSchema, reason: text })),
  /** Small and clear enough to skip the council? */
  quickQuest: v.strictObject({ recommended: v.boolean(), reason: text }),
  /** Past campaigns whose records bear on this task (§4.1, #168); briefs from before M7 have none. */
  relatedCampaigns: v.optional(
    v.pipe(v.array(v.strictObject({ campaignId: text, title: text, why: text })), v.maxLength(5)),
  ),
  /**
   * When the council's context was kept from an earlier campaign (§4.9, #168): whether this task is
   * related to that work. Null without a kept context.
   */
  keptContext: v.optional(v.nullable(v.strictObject({ related: v.boolean(), reason: text }))),
});
export type ResearchBrief = v.InferOutput<typeof ResearchBriefSchema>;
