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
};

/** How a character looks at the council table in a pose: its 32×32 council sheet, else its map sheet at 2× (§9.2). */
export function councilLook({ key, character }: PackCharacter, pose: CouncilPose): CouncilLook {
  if (character.council) {
    const texture = councilTexture(key);
    return { texture, animation: `${texture}:${pose}`, scale: 1 };
  }
  const name =
    MAP_FALLBACK[pose].find((n) => character.animations[n as keyof typeof character.animations]) ??
    'idle';
  return { texture: key, animation: `${key}:${name}`, scale: 2 };
}
