import type { Effort } from '@ibitsa/protocol';

/** One island's party as party assembly first fills it in (§7.1 screen 4, #123). */
export interface PartyRow {
  /** The plan's island id, e.g. `I1`. */
  islandId: string;
  title: string;
  /** The island's task titles, in the order its hero works them. */
  tasks: string[];
  classId: string;
  heroName: string;
  /** Councillors with criteria on the island's tasks: they review its work (M5). */
  councillors: string[];
}

/** A gold cap typed into party assembly: the default pouch, none, or dollars. */
export type CapInput =
  | { ok: true; budgetMicroUsd: number | null | undefined }
  | { ok: false; problem: string };

/** One review effort party assembly offers (§5.5). */
export interface ReviewEffortOption {
  id: Effort;
  label: string;
}
