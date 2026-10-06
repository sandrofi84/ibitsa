import * as v from 'valibot';
import { type ResearchBrief, ResearchBriefSchema } from './elder.schema';

/**
 * Checks a brief from the elder (spec §4.1): the schema, and that it names only councillors who exist.
 * Problems are short lines the elder can act on.
 */
export function checkBrief({
  input,
  councillors,
}: {
  input: unknown;
  councillors: readonly string[];
}): { ok: true; brief: ResearchBrief } | { ok: false; problems: string[] } {
  const parsed = v.safeParse(ResearchBriefSchema, input);
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.issues.map((issue) => {
        const path = v.getDotPath(issue);
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const brief = parsed.output;
  const named = [
    ...brief.councillors.map((c) => c.councillorId),
    ...brief.slices.map((s) => s.councillorId),
    ...brief.councillorEfforts.map((e) => e.councillorId),
  ];
  const problems = [...new Set(named)]
    .filter((id) => !councillors.includes(id))
    .map((id) => `"${id}" isn't a councillor. Choose from: ${councillors.join(', ') || 'none'}.`);
  return problems.length > 0 ? { ok: false, problems } : { ok: true, brief };
}
