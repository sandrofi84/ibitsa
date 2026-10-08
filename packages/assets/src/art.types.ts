import type { OPTIONAL_ANIMATIONS, REQUIRED_ANIMATIONS } from './manifest.ts';
import type { Rgba } from './raster.types.ts';

export type Palette = Record<string, Rgba>;

export interface CharacterArt {
  key: string;
  role: 'hero' | 'councillor';
  palette: Palette;
  backdrop: Rgba;
}

/** A character's map animation, required or optional (§9.2). */
export type MapAnimation =
  | (typeof REQUIRED_ANIMATIONS)[number]
  | (typeof OPTIONAL_ANIMATIONS)[number];
