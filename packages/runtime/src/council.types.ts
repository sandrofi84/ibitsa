import type { CouncillorInfo, Effort } from '@ibitsa/protocol';

/** What a council version is made of (§4.10). */
export interface CouncilVersionInput {
  /** How the council sits, e.g. `roundTable` or `chambers`. */
  mode: string;
  councillors: readonly Pick<CouncillorInfo, 'id' | 'hash'>[];
  /** Changes whenever Ibitsa's own council prompts change: the adapter hashes them. */
  promptVersion: string;
}

/** The models and cap a sitting's session starts with (spec §4.2). */
export interface SittingPlan {
  /** The round table's, or the chairing elder's in separate chambers. */
  model: string;
  roster: { councillorId: string; effort: Effort; model?: string }[];
}
