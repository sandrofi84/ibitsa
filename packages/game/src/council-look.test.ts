import { buildDefaultPack } from '@ibitsa/assets';
import { describe, expect, it } from 'vitest';
import { councilLook } from './council-look';

const { manifest } = buildDefaultPack();
const character = (key: string) => {
  const c = manifest.characters[key];
  if (!c) throw new Error(`no ${key}`);
  return c;
};

describe('councilLook', () => {
  it('uses the council sheet at 1× when the character has one', () => {
    expect(
      councilLook(
        { key: 'councillor.elder', character: character('councillor.elder') },
        'raiseHand',
      ),
    ).toEqual({
      texture: 'councillor.elder:council',
      animation: 'councillor.elder:council:raiseHand',
      scale: 1,
    });
  });

  it('scales the map sheet up 2× without one, borrowing the nearest animation', () => {
    const ranger = { key: 'hero.ranger', character: character('hero.ranger') };
    expect(councilLook(ranger, 'think')).toEqual({
      texture: 'hero.ranger',
      animation: 'hero.ranger:work',
      scale: 2,
    });
    expect(councilLook(ranger, 'write').animation).toBe('hero.ranger:work');
    expect(councilLook(ranger, 'idle').animation).toBe('hero.ranger:idle');
  });

  it('prefers an optional map animation when the pack has it', () => {
    const base = character('hero.ranger');
    const asker = {
      key: 'hero.ranger',
      character: {
        ...base,
        animations: { ...base.animations, ask: { row: 3, frames: 4, fps: 4 } },
      },
    };
    expect(councilLook(asker, 'talk').animation).toBe('hero.ranger:ask');
    expect(councilLook(asker, 'raiseHand').animation).toBe('hero.ranger:ask');
  });

  it('falls back to idle when nothing nearer exists', () => {
    const base = character('hero.ranger');
    const plain = {
      key: 'p',
      character: { ...base, animations: { idle: { row: 0, frames: 4, fps: 4 } } },
    };
    expect(councilLook(plain, 'think').animation).toBe('p:idle');
  });
});
