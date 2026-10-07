/** A colour as red, green and blue, 0–255. */
export type Rgb = [number, number, number];

/** A colour as hue (degrees), saturation and lightness (0–1). */
export interface Hsl {
  h: number;
  s: number;
  l: number;
}
