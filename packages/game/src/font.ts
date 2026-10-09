import type { Drawable } from './font.types';

/**
 * The pixel font canvas text is drawn in (#246), bundled with the game beside Phaser's own textures.
 * Its glyphs are drawn at one size and scaled with the rest of the art, so text stays crisp.
 */
export const FONT_KEY = 'font:ibitsa-pixel';
export const FONT_FILES = { image: 'textures/ibitsa-pixel.png', data: 'textures/ibitsa-pixel.xml' };
/** The size the font is drawn at (one texture pixel per screen pixel at zoom 1), and its line height. */
export const FONT_SIZE = 8;
export const FONT_LINE = 9;

/** Characters the font has no glyph for, written with the nearest one it has. */
const NEAREST: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '−': '-',
  '«': '"',
  '»': '"',
  '\t': ' ',
};

/**
 * Text the font can draw: each character as it is when the font has it, else its nearest (curly quotes
 * straight, an accented letter plain, any space a space), else `?`. Line breaks stay.
 */
export function drawable({ text, has }: Drawable): string {
  let out = '';
  for (const char of text) {
    if (char === '\n' || has(char)) out += char;
    else if (char === '\r') continue;
    else out += nearest({ char, has });
  }
  return out;
}

function nearest({ char, has }: { char: string; has: (char: string) => boolean }): string {
  const mapped = NEAREST[char];
  if (mapped !== undefined && has(mapped)) return mapped;
  if (/\s/u.test(char) && has(' ')) return ' ';
  const plain = char.normalize('NFD').replace(/\p{M}/gu, '');
  if (plain.length > 0 && [...plain].every(has)) return plain;
  return '?';
}

/** A CSS colour `#rrggbb` (or `#rgb`) as the number Phaser tints with. */
export function tintOf(color: string): number {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a colour: ${color}`);
  return Number.parseInt(full, 16);
}
