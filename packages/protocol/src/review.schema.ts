import * as v from 'valibot';

// What a reviewer files with `submit_verdict` (spec §5.5, #136). It comes from a model, so core checks it
// (`checkVerdict`) before the hero or the user sees it.

const text = v.pipe(v.string(), v.trim(), v.nonEmpty());

export const FindingSchema = v.strictObject({
  severity: v.picklist(['blocking', 'suggestion']),
  /** The acceptance criterion it fails, word for word. */
  criterion: v.optional(text),
  /** Why it blocks when no criterion covers it. */
  kind: v.optional(v.picklist(['bug', 'security', 'breaks'])),
  file: v.optional(text),
  line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  message: text,
  /** "Revisit D3?": a recorded decision the reviewer would reconsider; it goes to the user, not the hero. */
  revisit: v.optional(v.pipe(v.string(), v.regex(/^D\d+$/))),
});
export type Finding = v.InferOutput<typeof FindingSchema>;

export const VerdictSchema = v.strictObject({
  verdict: v.picklist(['pass', 'changes']),
  findings: v.pipe(v.array(FindingSchema), v.maxLength(30)),
});
export type Verdict = v.InferOutput<typeof VerdictSchema>;
