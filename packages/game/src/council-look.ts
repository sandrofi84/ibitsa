import type { CouncilLook, CouncilPose, PackCharacter } from './council-look.types';

/** The texture key of a character's council sheet, loaded by the pack scene. */
export const councilTexture = (key: string) => `${key}:council`;

/** Without a council sheet, each pose borrows the nearest map animation, else idle. */
const MAP_FALLBACK: Record<CouncilPose, readonly string[]> = {
  idle: ['idle'],
  talk: ['ask', 'idle'],
  think: ['work', 'idle'],
  raiseHand: ['ask', 'idle'],
  write: ['work', 'idle'],
  walk: ['walk', 'idle'],
};

/**
 * How a character looks at the council table in a pose: its 48×48 full-body council sheet, else its
 * map sheet at 3× (§9.2, #219). A council sheet without the optional walk-in stands idle for it.
 */
export function councilLook({ key, character }: PackCharacter, pose: CouncilPose): CouncilLook {
  if (character.council) {
    if (pose === 'walk' && !character.council.animations.walk) {
      const texture = councilTexture(key);
      return { texture, animation: `${texture}:idle`, scale: 1 };
    }
    const texture = councilTexture(key);
    return { texture, animation: `${texture}:${pose}`, scale: 1 };
  }
  const name =
    MAP_FALLBACK[pose].find((n) => character.animations[n as keyof typeof character.animations]) ??
    'idle';
  return { texture: key, animation: `${key}:${name}`, scale: 3 };
}
