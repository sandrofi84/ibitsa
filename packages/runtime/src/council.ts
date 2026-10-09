import { createHash } from 'node:crypto';
import type { CouncillorInfo, Effort, SittingMode } from '@ibitsa/protocol';
import type { CouncilVersionInput, SittingPlan } from './council.types';

/**
 * A short id for the council as it sat (§4.10, #98): its mode, which councillors with which skill files,
 * and Ibitsa's prompt version. Tallies group by it, so editing a councillor or a prompt starts a new group.
 * The roster's order doesn't matter.
 */
export function councilVersion({ mode, councillors, promptVersion }: CouncilVersionInput): string {
  const seats = councillors.map((c) => `${c.id}@${c.hash}`).sort();
  return createHash('sha256')
    .update(JSON.stringify({ mode, seats, promptVersion }))
    .digest('hex')
    .slice(0, 12);
}

/** The councillors the user hasn't turned off (`ibitsa.council.disabled`, §4.7). */
export function seatable(
  councillors: readonly CouncillorInfo[],
  disabled: readonly string[],
): CouncillorInfo[] {
  return councillors.filter((c) => !disabled.includes(c.id));
}

/** A round table's model by effort (spec §4.2). Effort no longer sets a gold cap (#272). */
const ROUND_TABLE: Record<Effort, string> = { light: 'haiku', standard: 'sonnet', deep: 'opus' };

/** A chamber's model by its councillor's effort (spec §4.2). */
const CHAMBER: Record<Effort, string> = { light: 'haiku', standard: 'sonnet', deep: 'sonnet' };

/** A reviewer's model by its review effort (§5.5, M5). */
const REVIEWER: Record<Effort, string> = { light: 'haiku', standard: 'sonnet', deep: 'opus' };

/**
 * The models a sitting runs with (#103, #105). A round table runs on its effort's model. In separate
 * chambers each councillor gets its effort's model, and the elder chairs on the sitting's effort
 * model. A sitting's gold cap is the user's, if they set one (#272).
 */
export function sittingPlan({
  mode,
  effort,
  roster,
}: {
  mode: SittingMode;
  effort: Effort;
  roster: readonly { councillorId: string; effort: Effort }[];
}): SittingPlan {
  const model = ROUND_TABLE[effort];
  if (mode === 'roundTable') return { model, roster: [...roster] };
  return { model, roster: roster.map((c) => ({ ...c, model: CHAMBER[c.effort] })) };
}

/** A reviewer's model by its review effort; its gold cap is the user's, if they set one (#272). */
export function reviewModel(effort: Effort): string {
  return REVIEWER[effort];
}
