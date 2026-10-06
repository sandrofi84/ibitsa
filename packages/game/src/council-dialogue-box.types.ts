import type { GameClient } from './client';

export interface CouncilDialogueOptions {
  client: GameClient;
  /** A portrait's URL for a pack character, e.g. `councillor.elder`; null without one. */
  portrait: (appearance: string) => string | null;
  /** Which question the box is on, so its councillor takes the floor in the hut; null when closed. */
  onFocus: (questionId: string | null) => void;
  /** The box was put away with "Later"; "Needs you" shows the questions instead. */
  onAway: () => void;
}

export interface CouncilDialogueBox {
  element: HTMLElement;
  /** Opens the box (after "Later") and moves keyboard focus into it; false when no question is open. */
  focus(): boolean;
}
