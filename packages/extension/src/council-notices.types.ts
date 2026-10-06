/** What the council last told the user about: the question batch and the plan (`sitting:version`). */
export interface Noticed {
  batch: string | null;
  plan: string | null;
}
