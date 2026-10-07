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

/** A round table's model and cap by effort (spec §4.2); starting numbers, to be tuned from tallies. */
const ROUND_TABLE: Record<Effort, { model: string; budgetMicroUsd: number }> = {
  light: { model: 'haiku', budgetMicroUsd: 500_000 },
  standard: { model: 'sonnet', budgetMicroUsd: 2_000_000 },
  deep: { model: 'opus', budgetMicroUsd: 6_000_000 },
};

/** A chamber's model and share of the cap by its councillor's effort (spec §4.2). */
const CHAMBER: Record<Effort, { model: string; budgetMicroUsd: number }> = {
  light: { model: 'haiku', budgetMicroUsd: 100_000 },
  standard: { model: 'sonnet', budgetMicroUsd: 400_000 },
  deep: { model: 'sonnet', budgetMicroUsd: 1_200_000 },
};

/** What the chairing elder keeps for summing up in separate chambers (spec §4.2). */
const ELDER_RESERVE = 300_000;

/**
 * The models and cap a sitting runs with (#103, #105). A round table runs on its effort's model and
 * cap. In separate chambers each councillor gets its effort's model, the elder chairs on the sitting's
 * effort model, and the cap is every chamber's share plus the elder's reserve.
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
  const table = ROUND_TABLE[effort];
  if (mode === 'roundTable') {
    return { model: table.model, maxBudgetMicroUsd: table.budgetMicroUsd, roster: [...roster] };
  }
  return {
    model: table.model,
    maxBudgetMicroUsd: roster.reduce(
      (sum, c) => sum + CHAMBER[c.effort].budgetMicroUsd,
      ELDER_RESERVE,
    ),
    roster: roster.map((c) => ({ ...c, model: CHAMBER[c.effort].model })),
  };
}

/** A reviewer's model and cap by its review effort (§5.5, M5); starting numbers, to be tuned. */
export function reviewPlan(effort: Effort): { model: string; budgetMicroUsd: number } {
  return {
    light: { model: 'haiku', budgetMicroUsd: 100_000 },
    standard: { model: 'sonnet', budgetMicroUsd: 400_000 },
    deep: { model: 'opus', budgetMicroUsd: 1_200_000 },
  }[effort];
}
