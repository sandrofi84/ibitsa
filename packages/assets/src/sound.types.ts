/** One note of a generated sound (§9.5, #184). */
export interface Note {
  wave: 'square' | 'triangle' | 'saw' | 'noise';
  /** Hz at the start; `slideTo` glides to another by the end. */
  freq: number;
  slideTo?: number;
  seconds: number;
  /** 0–1. */
  volume?: number;
  /** Seconds of rise at the start; the rest decays. */
  attack?: number;
}
