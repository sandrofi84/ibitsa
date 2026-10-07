import type { Plan } from '@ibitsa/protocol';

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
