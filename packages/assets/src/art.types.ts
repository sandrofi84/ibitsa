import type { Rgba } from './raster.types.ts';

export type Palette = Record<string, Rgba>;

export interface CharacterArt {
  key: string;
  role: 'hero' | 'councillor';
  palette: Palette;
  backdrop: Rgba;
}
