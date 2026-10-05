import type { Hero, QuestSettings } from './state';

// The gold pouch (spec §7.3): core owns the rule, adapters only report what they can.

export function capFor(settings: QuestSettings): Hero['cap'] {
  if (settings.budgetMicroUsd === null || settings.budget === 'none') return null;
  return { microUsd: settings.budgetMicroUsd, enforcement: settings.budget };
}

export function spent(hero: Hero): number {
  return hero.gold.kind === 'unknown' ? 0 : hero.gold.value;
}

/** For adapters with a native cap: what is left, so a restart can't reset the budget. */
export function remainder(hero: Hero): { maxBudgetMicroUsd?: number } {
  if (hero.cap?.enforcement !== 'native') return {};
  return { maxBudgetMicroUsd: Math.max(0, hero.cap.microUsd - spent(hero)) };
}

export function overBudget(hero: Hero): boolean {
  return hero.cap !== null && spent(hero) >= hero.cap.microUsd;
}
