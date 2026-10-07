import type { GameClient } from './client';

export interface CouncilChamberOptions {
  client: GameClient;
  /** A portrait's URL for a pack character, e.g. `councillor.elder`; null without one. */
  portrait: (appearance: string) => string | null;
  /** The chamber opened: the hut shows. */
  onOpen: () => void;
  /** Back to the map. */
  onClose: () => void;
}

/** The council's chamber mid-campaign (§4.8, #169): the dialogue and a box to ask the council. */
export interface CouncilChamber {
  /** Opens over the hut; false when the council can't be asked now. */
  open(): boolean;
  close(): void;
  shown(): boolean;
}

/** One line of the chamber's dialogue, as shown: who speaks and what they say. */
export interface ChamberLine {
  id: string;
  speaker: string;
  /** "You", or the councillor's title. */
  name: string;
  text: string;
}
