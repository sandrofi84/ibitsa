export interface HeroClass {
  id: string;
  label: string;
  /** Shown next to the class: which model it runs (spec §5.2). */
  model: string;
  /** Suggested names; the user may type their own. */
  names: string[];
  /** The pack character its heroes look like (#182). */
  appearance: string;
}
