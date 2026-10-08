import type { Manifest } from '@ibitsa/assets';

/** What a councillor is doing at the hut's table; one council sheet animation each (§9.2). */
export type CouncilPose = 'idle' | 'talk' | 'think' | 'raiseHand' | 'write' | 'walk';

/** A pack character by its key. */
export interface PackCharacter {
  key: string;
  character: Manifest['characters'][string];
}

/** How to draw a councillor in a pose: which texture and animation, at what scale. */
export interface CouncilLook {
  texture: string;
  animation: string;
  /** 1 for a 48×48 council sheet; 3 for the 16×16 map sheet scaled up (nearest neighbour, as the game is pixelArt). */
  scale: 1 | 3;
}
