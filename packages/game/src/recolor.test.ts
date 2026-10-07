import { describe, expect, it } from 'vitest';
import {
  isPlain,
  recolorFilter,
  recolorOf,
  recolorPixels,
  recolorRgb,
  setRecolor,
} from './recolor';

describe('recolor (#182)', () => {
  it('turns a colour by the hue shift, keeping greys and lightness', () => {
    // Pure red turned a third of the way round is pure green.
    expect(recolorRgb({ rgb: [255, 0, 0], recolor: { hue: 120, preset: 'none' } })).toEqual([
      0, 255, 0,
    ]);
    expect(recolorRgb({ rgb: [128, 128, 128], recolor: { hue: 90, preset: 'none' } })).toEqual([
      128, 128, 128,
    ]);
    expect(recolorRgb({ rgb: [255, 0, 0], recolor: { hue: -120, preset: 'none' } })).toEqual([
      0, 0, 255,
    ]);
  });

  it('moves colours to a preset’s hue, and darkens and greys them for shadow', () => {
    const [r, g, b] = recolorRgb({ rgb: [40, 80, 200], recolor: { hue: 0, preset: 'gold' } });
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
    const shadow = recolorRgb({ rgb: [200, 40, 40], recolor: { hue: 0, preset: 'shadow' } });
    expect(Math.max(...shadow)).toBeLessThan(200);
    expect(Math.max(...shadow) - Math.min(...shadow)).toBeLessThan(160);
  });

  it('recolors opaque pixels and leaves transparent ones alone', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 0]);
    recolorPixels({ data, recolor: { hue: 120, preset: 'none' } });
    expect([...data]).toEqual([0, 255, 0, 255, 255, 0, 0, 0]);
  });

  it('gives portraits the nearest CSS filter, and none for no change', () => {
    expect(recolorFilter(undefined)).toBe('');
    expect(recolorFilter({ hue: 0, preset: 'none' })).toBe('');
    expect(recolorFilter({ hue: 90, preset: 'none' })).toBe('hue-rotate(90deg)');
    expect(recolorFilter({ hue: 0, preset: 'shadow' })).toBe('saturate(0.35) brightness(0.6)');
    for (const preset of ['gold', 'frost', 'ember', 'verdant'] as const) {
      expect(recolorFilter({ hue: 30, preset })).toMatch(/^hue-rotate\(30deg\) sepia\(1\)/);
    }
  });

  it('follows the snapshot’s recolors', () => {
    setRecolor({ 'class:ranger': { hue: 60, preset: 'none' } });
    expect(recolorOf('class:ranger')).toEqual({ hue: 60, preset: 'none' });
    expect(recolorOf('class:rogue')).toBeUndefined();
    setRecolor(undefined);
    expect(recolorOf('class:ranger')).toBeUndefined();
    expect(isPlain(undefined)).toBe(true);
    expect(isPlain({ hue: 15, preset: 'none' })).toBe(false);
  });
});
