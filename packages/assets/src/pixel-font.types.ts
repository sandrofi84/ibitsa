import type { Raster } from './raster.ts';

/** The game's pixel font (#246): its glyph image, its BMFont XML, and the characters it draws. */
export interface PixelFont {
  image: Raster;
  xml: string;
  chars: readonly string[];
}
