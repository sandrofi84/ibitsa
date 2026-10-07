import type { MicroUsd, Reading } from './values.types';

// The end of a campaign (spec §4.9, #167): its record, the elder's lessons, and the council's context.

/** From the elder's short lessons session: a few lessons from the review rounds, escalations and disputes. */
export type LessonsEvent =
  | { type: 'sessionStarted'; sessionId: string }
  | { type: 'lessonsSubmitted'; lessons: string[] }
  | { type: 'usage'; totalCost: MicroUsd }
  | { type: 'error'; message: string };

/** What to do with the council's context after Finish (§4.9). */
export type CouncilContextChoice = 'empty' | 'compact' | 'keep';

/** How the campaign's end is going, as front ends see it. */
export interface CampaignEndView {
  /** `lessons` while the elder writes them, `writing` while the record is saved, then `written` or `failed`. */
  record: 'lessons' | 'writing' | 'written' | 'failed';
  /** Where `record.md` was written, once it was. */
  recordPath: string | null;
  /** Why it couldn't be written. */
  recordError: string | null;
  /**
   * Finish only: `pending` until the user chooses what happens to the council's context, then the
   * choice; null when there was no council (a quick quest) or the campaign was abandoned (emptied).
   */
  councilContext: 'pending' | CouncilContextChoice | null;
  /** How big the council's context is, in tokens, when known: shown with the choice. */
  councilTokens: number | null;
  /** The lessons' cost, part of the campaign's gold. */
  lessonsGold: Reading<MicroUsd>;
}
