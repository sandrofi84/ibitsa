import type { Effort } from '@ibitsa/protocol';

/** A councillor's chamber: the subagent it runs as. */
export interface Chamber {
  /** The subagent's name: the councillor's id, or `<id>-deep` for its deeper pass. */
  name: string;
  councillorId: string;
  effort: Effort;
  model: string;
  maxTurns: number;
  prompt: string;
}
