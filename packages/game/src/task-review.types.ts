import type { ReviewView } from '@ibitsa/protocol';

/** A finding as the task panel and Needs you show it. */
export interface FindingLine {
  /** "Blocking" or "Suggestion". */
  severity: string;
  /** Why it blocks: the criterion it fails, or bug / security / breaks; null for a suggestion without one. */
  why: string | null;
  /** `file:line`, `file`, or null. */
  where: string | null;
  message: string;
  /** "Asks to revisit D3", when it does. */
  revisit: string | null;
}

/** One round of a task's review: its reviews in the order they started. */
export interface ReviewRound {
  round: number;
  reviews: ReviewView[];
}
