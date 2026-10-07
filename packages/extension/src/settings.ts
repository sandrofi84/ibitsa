import type { UserSettings } from '@ibitsa/runtime';
import type { ConfigReader } from './settings.types';

const DEFAULT_STALL = { testFailures: 4, fileEdits: 12, noProgressTurns: 6 };

/** `ibitsa.*` settings → what the runtime logs before each quest. The budget is in dollars in settings. */
export function readUserSettings(config: ConfigReader): UserSettings {
  const budgetUsd = config.get<number | null>('hero.budgetUsd');
  const parallel = config.get<number>('parties.maxParallel');
  const loopLimit = config.get<number>('review.loopLimit');
  const campaignUsd = config.get<number | null>('campaign.budgetUsd');
  return {
    budgetMicroUsd:
      typeof budgetUsd === 'number' && budgetUsd > 0 ? Math.round(budgetUsd * 1_000_000) : null,
    stall: DEFAULT_STALL,
    maxParallel: typeof parallel === 'number' && parallel >= 1 ? Math.floor(parallel) : 2,
    loopLimit: typeof loopLimit === 'number' && loopLimit >= 1 ? Math.floor(loopLimit) : 3,
    campaignBudgetMicroUsd:
      typeof campaignUsd === 'number' && campaignUsd > 0
        ? Math.round(campaignUsd * 1_000_000)
        : null,
  };
}

/** `ibitsa.pullRequests.pollSeconds`: how often open PRs are polled (§5.6); 60, and at least 15. */
export function readPollSeconds(config: ConfigReader): number {
  const seconds = config.get<number>('pullRequests.pollSeconds');
  return typeof seconds === 'number' && seconds >= 15 ? Math.floor(seconds) : 60;
}

/** `ibitsa.council.disabled`: councillor ids the council never seats (§4.7, #98). */
export function readDisabledCouncillors(config: ConfigReader): string[] {
  const ids = config.get<unknown>('council.disabled');
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

const ELDER_MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const COUNCIL_MODES = ['ask', 'roundTable', 'chambers'] as const;

/** `ibitsa.council.mode`: ask how the council sits each time, or always one way (§4.2, #103). */
export function readCouncilMode(config: ConfigReader): (typeof COUNCIL_MODES)[number] {
  const mode = config.get<unknown>('council.mode');
  return COUNCIL_MODES.find((m) => m === mode) ?? 'ask';
}

/** `ibitsa.elder.*`: the elder's model and cap (spec §4.1, #101); Haiku and $0.25 unless set. */
export function readElderSettings(config: ConfigReader): { model: string; budgetMicroUsd: number } {
  const model = config.get<unknown>('elder.model');
  const budgetUsd = config.get<unknown>('elder.budgetUsd');
  return {
    model: typeof model === 'string' && ELDER_MODELS.includes(model) ? model : 'haiku',
    budgetMicroUsd:
      typeof budgetUsd === 'number' && budgetUsd > 0 ? Math.round(budgetUsd * 1_000_000) : 250_000,
  };
}

/**
 * `ibitsa.checks` (§5.5, M5): the commands checks run, an empty list for none, or null (unset) to use the
 * worktree's `package.json` scripts. Blank or non-text entries are left out.
 */
export function readChecks(config: ConfigReader): string[] | null {
  const checks = config.get<unknown>('checks');
  if (!Array.isArray(checks)) return null;
  return checks
    .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
    .map((c) => c.trim());
}
