import { encodePng } from './png.ts';

export type Rgba = readonly [number, number, number, number];

export function hex(color: string, alpha = 255): Rgba {
  const n = Number.parseInt(color.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255, alpha];
}

export const CLEAR: Rgba = [0, 0, 0, 0];

/** An RGBA pixel buffer with the few drawing operations placeholder art needs. */
export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  set(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || color[3] === 0) return;
    this.data.set(color, (y * this.width + x) * 4);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgba): void {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
  }

  /** Draw a character template: one string per row, each char a palette key ('.' = transparent). */
  pattern(x: number, y: number, rows: readonly string[], palette: Record<string, Rgba>): void {
    rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const color = palette[ch];
        if (color) this.set(x + i, y + j, color);
      });
    });
  }

  /** Copy another raster in, scaled by an integer factor. */
  blit(src: Raster, x: number, y: number, scale = 1): void {
    for (let j = 0; j < src.height; j++) {
      for (let i = 0; i < src.width; i++) {
        const o = (j * src.width + i) * 4;
        const color: Rgba = [
          src.data[o] ?? 0,
          src.data[o + 1] ?? 0,
          src.data[o + 2] ?? 0,
          src.data[o + 3] ?? 0,
        ];
        this.rect(x + i * scale, y + j * scale, scale, scale, color);
      }
    }
  }

  png(): Buffer {
    return encodePng(this.width, this.height, this.data);
  }
}
