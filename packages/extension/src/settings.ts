import type { UserSettings } from '@ibitsa/runtime';
import type { ConfigReader } from './settings.types';

const DEFAULT_STALL = { testFailures: 4, fileEdits: 12, noProgressTurns: 6 };

/** `ibitsa.*` settings → what the runtime logs before each quest. The budget is in dollars in settings. */
export function readUserSettings(config: ConfigReader): UserSettings {
  const budgetUsd = config.get<number | null>('hero.budgetUsd');
  return {
    budgetMicroUsd:
      typeof budgetUsd === 'number' && budgetUsd > 0 ? Math.round(budgetUsd * 1_000_000) : null,
    stall: DEFAULT_STALL,
  };
}

/** `ibitsa.council.disabled`: councillor ids the council never seats (§4.7, #98). */
export function readDisabledCouncillors(config: ConfigReader): string[] {
  const ids = config.get<unknown>('council.disabled');
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}
