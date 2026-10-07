import type { SoundSlot } from './sound-cues.types';

/** What the sound board did, for tests (#184): each sound it played, and how loud. */
export interface SoundBoard {
  played(): { slot: SoundSlot | string; volume: number }[];
}
