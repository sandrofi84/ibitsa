/** A hero class as everyone sees it (§5.2, #182): the built-ins, remapped or added to in settings. */
export interface HeroClassView {
  id: string;
  name: string;
  /** A model alias or id the adapter runs heroes of this class on. */
  model: string;
  /** The pack character heroes of this class look like, e.g. `hero.paladin`. */
  appearance: string;
  /** Suggested hero names. */
  names: string[];
  /** One of the four that ship with Ibitsa. */
  builtIn: boolean;
}
