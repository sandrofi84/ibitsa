/** Text to draw, and whether the font has a glyph for a character. */
export interface Drawable {
  text: string;
  has: (char: string) => boolean;
}
