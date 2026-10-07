import * as v from 'valibot';
import { type Verdict, VerdictSchema } from './review.schema';

/**
 * Checks a reviewer's verdict (spec §5.5, #136): the schema; a blocking finding says why (a criterion,
 * or bug, security or breaks); a "revisit" names a decision of the plan and doesn't block; and the
 * verdict agrees with its findings (changes needs a blocking finding, pass has none).
 */
export function checkVerdict({
  input,
  decisions,
}: {
  input: unknown;
  decisions: readonly string[];
}): { ok: true; verdict: Verdict } | { ok: false; problems: string[] } {
  const parsed = v.safeParse(VerdictSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.issues.map((issue) => {
        const path = v.getDotPath(issue);
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const verdict = parsed.output;
  const problems: string[] = [];
  verdict.findings.forEach((f, i) => {
    if (f.severity === 'blocking' && f.criterion === undefined && f.kind === undefined) {
      problems.push(
        `findings.${i}: a blocking finding needs the criterion it fails, or a kind (bug, security, breaks).`,
      );
    }
    if (f.revisit !== undefined && !decisions.includes(f.revisit)) {
      problems.push(`findings.${i}: ${f.revisit} isn't a decision of this plan.`);
    }
    if (f.revisit !== undefined && f.severity === 'blocking') {
      problems.push(
        `findings.${i}: you can't block on a recorded decision; file it as a suggestion with revisit.`,
      );
    }
  });
  const blocking = verdict.findings.some((f) => f.severity === 'blocking');
  if (verdict.verdict === 'changes' && !blocking)
    problems.push('A "changes" verdict needs a blocking finding.');
  if (verdict.verdict === 'pass' && blocking)
    problems.push('A "pass" verdict can\'t have blocking findings.');
  return problems.length > 0 ? { ok: false, problems } : { ok: true, verdict };
}
