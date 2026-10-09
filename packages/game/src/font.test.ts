import { describe, expect, it } from 'vitest';
import { drawable, tintOf } from './font';

const ascii = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code >= 32 && code < 127;
};
const has = (char: string) => ascii(char) || char === '…' || char === '›';

describe('text the pixel font can draw (#246)', () => {
  it('keeps what the font has, line breaks included', () => {
    expect(drawable({ text: 'Book of Decisions · 3', has: (c) => has(c) || c === '·' })).toBe(
      'Book of Decisions · 3',
    );
    expect(drawable({ text: 'one\ntwo', has })).toBe('one\ntwo');
    expect(drawable({ text: 'Pushing…', has })).toBe('Pushing…');
  });

  it('straightens curly quotes and writes other spaces as a space', () => {
    expect(drawable({ text: '“Don’t”', has })).toBe(`"Don't"`);
    expect(drawable({ text: 'a b\tc', has })).toBe('a b c');
  });

  it('writes accented letters plain', () => {
    expect(drawable({ text: 'Café Ñandú', has })).toBe('Cafe Nandu');
  });

  it('drops carriage returns', () => {
    expect(drawable({ text: 'a\r\nb', has })).toBe('a\nb');
  });

  it('writes a ? for anything it has nothing near', () => {
    expect(drawable({ text: 'Ω 🚀 漢', has })).toBe('? ? ?');
  });

  it('writes a ? when even the nearest character is missing', () => {
    expect(drawable({ text: '’', has: (c) => ascii(c) && c !== "'" })).toBe('?');
  });
});

describe('tint colours', () => {
  it('reads #rrggbb and #rgb', () => {
    expect(tintOf('#f2c230')).toBe(0xf2c230);
    expect(tintOf('#fff')).toBe(0xffffff);
  });

  it('refuses anything else', () => {
    expect(() => tintOf('red')).toThrow('Not a colour: red');
    expect(() => tintOf('#12345g')).toThrow();
  });
});
