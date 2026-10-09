/** What the user chose when the game tab closed while a campaign ran (#265). */
export type ClosedChoice = 'keep' | 'pause' | 'stop';

/** The parts of the runtime host closing the game needs. */
export interface ClosingHost {
  /** Whether a campaign is planning or running. */
  campaignLive(): boolean;
  /** Stops every hero's turn; they wait for orders. How many were working. */
  pauseHeroes(): Promise<number>;
  /** Shuts the runtime down, as a window reload does; opening the game starts it again. */
  dispose(): void;
}

export interface GameClosedInput {
  host: ClosingHost | null;
  /** Asks what to do, the answer null when the user dismissed the question. */
  ask: () => Promise<ClosedChoice | null>;
  /** A short notice of what was done. */
  tell: (text: string) => void;
}
