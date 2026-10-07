/** The sound slots the game plays (§9.4, #184), as the pack names them. */
export type SoundSlot =
  | 'needsYou'
  | 'councillorSpeaks'
  | 'taskDone'
  | 'reviewPassed'
  | 'reviewFailed'
  | 'prOpened'
  | 'prMerged'
  | 'hpLow'
  | 'resting'
  | 'campaignStart'
  | 'campaignEnd';

/** A sound to play now; `speaker` pitches a councillor's blip. */
export interface SoundCue {
  slot: SoundSlot;
  speaker?: string;
}

/** Which volume a sound follows (§9.4). */
export type SoundCategory = 'alerts' | 'voices' | 'effects' | 'music';

/** The volume settings, as numbers 0–100 and Focus mode (`ibitsa.sound.*`). */
export interface SoundLevels {
  master: number;
  alerts: number;
  voices: number;
  effects: number;
  music: number;
  /** Only "Needs you" plays. */
  focus: boolean;
}
