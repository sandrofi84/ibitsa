/** A hero class as everyone sees it (§5.2, #182): the built-ins, remapped or added to in settings. */
export interface HeroClassView {
  id: string;
  name: string;
  /** The agent heroes of this class run on (§11.5, #198): `claude`, or an `ibitsa.agents` id. */
  agent: string;
  /** A model alias or id the adapter runs heroes of this class on; empty: the ACP agent's default. */
  model: string;
  /** The pack character heroes of this class look like, e.g. `hero.paladin`. */
  appearance: string;
  /** Suggested hero names. */
  names: string[];
  /** One of the four that ship with Ibitsa. */
  builtIn: boolean;
  /**
   * False when heroes of this class run without Ibitsa's sandbox (§11.5, #200): an ACP agent on
   * native Windows, or one with no sandbox profile. Added by the runtime; absent means sandboxed as
   * the platform allows (`Snapshot.sandboxed`).
   */
  sandboxed?: false;
}
