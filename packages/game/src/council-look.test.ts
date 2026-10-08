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

  it('scales the map sheet up 3× without one, borrowing the nearest animation (#219)', () => {
    const ranger = { key: 'hero.ranger', character: character('hero.ranger') };
    expect(councilLook(ranger, 'think')).toEqual({
      texture: 'hero.ranger',
      animation: 'hero.ranger:work',
      scale: 3,
    });
    expect(councilLook(ranger, 'walk').animation).toBe('hero.ranger:walk');
    expect(councilLook(ranger, 'write').animation).toBe('hero.ranger:work');
    expect(councilLook(ranger, 'idle').animation).toBe('hero.ranger:idle');
  });

  it('walks in on the council sheet, or stands idle when the sheet has no walk-in (#219)', () => {
    const elder = character('councillor.elder');
    expect(councilLook({ key: 'councillor.elder', character: elder }, 'walk').animation).toBe(
      'councillor.elder:council:walk',
    );
    const council = elder.council;
    if (!council) throw new Error('no council sheet');
    const { walk: _, ...still } = council.animations;
    const old = { key: 'old', character: { ...elder, council: { ...council, animations: still } } };
    expect(councilLook(old, 'walk')).toEqual({
      texture: 'old:council',
      animation: 'old:council:idle',
      scale: 1,
    });
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
