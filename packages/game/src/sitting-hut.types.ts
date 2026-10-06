import type { SittingView } from '@ibitsa/protocol';

/** A sitting as the hut shows it, and which question the dialogue box is on (§7.1 screen 2). */
export interface SittingFocus {
  sitting: SittingView;
  /** The question the dialogue box shows; its councillor has the floor. */
  focus: string | null;
}
