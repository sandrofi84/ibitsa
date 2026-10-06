import type { ActivityKind } from './snapshot.types';

/** What one journal line says, by kind (#58). */
export type JournalEntryBody =
  /** The hero's message, in full. */
  | { kind: 'said'; text: string }
  /** A tool run, once it finished. */
  | { kind: 'tool'; activity: ActivityKind; detail?: string; outcome: 'ok' | 'failed' }
  /** A permission or question the hero asked you. */
  | { kind: 'asked'; text: string }
  /** Your answer to one. */
  | { kind: 'answered'; text: string }
  /** Your message to the hero. */
  | { kind: 'you'; text: string; priority: 'now' | 'next' }
  /** Everything else worth a line: quest started, stopped, resumed, stalled, errors, submitted. */
  | { kind: 'event'; text: string };

/**
 * One line of a hero's journal (#58): what the hero did and said, and what you did, built from the
 * campaign log. `t` is milliseconds since the campaign started; `heroId` is null for quest-wide events.
 */
export type JournalEntry = { t: number; heroId: string | null } & JournalEntryBody;
