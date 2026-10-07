/** A hero as the Command Palette offers it. */
export interface HeroOption {
  id: string;
  /** Its name, shown as the pick's label. */
  label: string;
  /** Its state, shown beside the name. */
  description: string;
}

/** Shows the options and returns the one chosen, or undefined when the pick is dismissed. */
export type HeroPicker = (options: HeroOption[]) => Promise<HeroOption | undefined>;
