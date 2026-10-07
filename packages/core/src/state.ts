import type { CoreState, QuestSettings } from './state.types';

export const DEFAULT_SETTINGS: QuestSettings = {
  budgetMicroUsd: null,
  budget: 'native',
  stall: { testFailures: 4, fileEdits: 12, noProgressTurns: 6 },
  maxParallel: 2,
  campaignBudgetMicroUsd: null,
};

export function initialState(): CoreState {
  return {
    nextId: 1,
    settings: DEFAULT_SETTINGS,
    campaign: null,
    elder: null,
    sitting: null,
    pastSittings: [],
    islands: [],
    heroes: [],
    needsYou: [],
  };
}

/** Ids come from a counter in the state, so a replay produces the same ids. */
export function newId(state: CoreState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}
