/**
 * What the council last told the user about: the question batch, the plan (`sitting:version`) and the
 * wait for the user (`sitting:lines`, #242).
 */
export interface Noticed {
  batch: string | null;
  plan: string | null;
  waiting?: string | null;
}
