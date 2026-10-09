import { describe, expect, it } from 'vitest';
import { FONT_CELL, FONT_FACE, FONT_LINE, pixelFont } from './pixel-font.ts';

describe('the pixel font (#246)', () => {
  const font = pixelFont();
  const described = [...font.xml.matchAll(/<char id="(\d+)" x="(\d+)" y="0" width="(\d+)"/g)].map(
    ([, id, x, width]) => ({
      char: String.fromCodePoint(Number(id)),
      x: Number(x),
      width: Number(width),
    }),
  );

  it('draws every printable ASCII character', () => {
    for (let code = 32; code < 127; code++)
      expect(font.chars, String.fromCharCode(code)).toContain(String.fromCharCode(code));
  });

  it('describes each glyph where the image draws it, a pixel apart', () => {
    expect(described.map((d) => d.char)).toEqual(font.chars);
    let x = 0;
    for (const d of described) {
      expect(d.x, d.char).toBe(x);
      x += d.width + 1;
    }
    expect(font.image.width).toBe(x);
    expect(font.image.height).toBe(FONT_CELL);
  });

  it('names its face, line height and image for Phaser', () => {
    expect(font.xml).toContain(`face="${FONT_FACE}"`);
    expect(font.xml).toContain(`lineHeight="${FONT_LINE}"`);
    expect(font.xml).toContain(`file="${FONT_FACE}.png"`);
  });

  it('draws only opaque white or nothing, so the game can tint it', () => {
    const seen = new Set<string>();
    for (let i = 0; i < font.image.data.length; i += 4)
      seen.add(Array.from(font.image.data.slice(i, i + 4)).join(','));
    expect([...seen].sort()).toEqual(['0,0,0,0', '255,255,255,255']);
  });

  it('leaves the space blank and draws something for every other glyph', () => {
    for (const d of described) {
      let lit = 0;
      for (let y = 0; y < FONT_CELL; y++)
        for (let x = d.x; x < d.x + d.width; x++)
          lit += font.image.data[(y * font.image.width + x) * 4 + 3] ? 1 : 0;
      if (d.char === ' ') expect(lit).toBe(0);
      else expect(lit, d.char).toBeGreaterThan(0);
    }
  });
});
