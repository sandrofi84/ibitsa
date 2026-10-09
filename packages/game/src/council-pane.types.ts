import type { GameClient } from './client';

export interface CouncilPaneOptions {
  client: GameClient;
  /** A portrait's URL for a pack character, e.g. `councillor.elder`; null without one. */
  portrait: (appearance: string) => string | null;
}

export interface CouncilWordOptions extends CouncilPaneOptions {
  /** Where the line shows: the command bar, so Needs you stays clear of both. */
  into: HTMLElement;
}

/** One councillor's report in the pane: filed (with what it holds) or still being written. */
export interface ReportRow {
  councillorId: string;
  title: string;
  filed: boolean;
  /** "2 concerns, 1 question", the bow-out's reason, or "studying…". */
  detail: string;
}

/** One line of the sitting's journal, as shown: who speaks and what they say. */
export interface JournalLine {
  id: string;
  speaker: string;
  /** "You", or the councillor's title. */
  name: string;
  text: string;
}
