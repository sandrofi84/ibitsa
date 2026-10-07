import type { Plan } from '@ibitsa/protocol';
import type { PartyRow } from './parties.types';

/** What the rest of the game can do with party assembly. */
export interface PartyAssembly {
  /** Opens it for the approved plan (§7.1 screen 4). */
  open(plan: Plan): void;
}

/** What party assembly needs from the rest of the game. */
export interface PartyAssemblyOptions {
  /** Runs `then` once the extension has credentials (the New Quest form's first-run card). */
  withCredentials: (then: () => void) => void;
}

/** The party of an island an amendment added (#170). */
export interface NewParty {
  /** Opens it for that island, while it waits for its party. */
  open(islandId: string): void;
}

/** One island's party fields in a form. */
export interface PartyFields {
  row: PartyRow;
  box: HTMLFieldSetElement;
  classSelect: HTMLSelectElement;
  name: HTMLInputElement;
  cap: HTMLInputElement;
  noCap: HTMLInputElement;
  efforts: { councillorId: string; select: HTMLSelectElement }[];
}
