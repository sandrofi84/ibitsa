import type { Recolor, RecolorMap, RecolorPreset } from '@ibitsa/protocol';
import type * as Phaser from 'phaser';
import type { Hsl, Rgb } from './recolor.types';

// Recolor (spec §5.2, #182): a hue shift, then a palette preset, per class and per councillor. The
// game draws a recolored copy of a character's sheet, pixel by pixel, so pixel art stays crisp; DOM
// portraits get the nearest CSS filter.

/** What a preset does after the hue shift: a hue it moves colours to, and saturation and lightness. */
const PRESETS: Record<RecolorPreset, { hue?: number; saturation: number; lightness: number }> = {
  none: { saturation: 1, lightness: 1 },
  gold: { hue: 45, saturation: 1.15, lightness: 1.05 },
  frost: { hue: 200, saturation: 0.75, lightness: 1.1 },
  ember: { hue: 12, saturation: 1.2, lightness: 1 },
  verdant: { hue: 110, saturation: 1, lightness: 1 },
  shadow: { saturation: 0.35, lightness: 0.6 },
};

/** Nothing to change. */
export function isPlain(recolor: Recolor | undefined): boolean {
  return !recolor || (recolor.hue === 0 && recolor.preset === 'none');
}

/** One colour, recolored. Greys keep their lightness, so outlines and highlights stay as drawn. */
export function recolorRgb({ rgb, recolor }: { rgb: Rgb; recolor: Recolor }): Rgb {
  const preset = PRESETS[recolor.preset];
  const hsl = toHsl(rgb);
  // A preset with a hue moves every colour to it; the shift then turns that, or the colour's own hue.
  const hue = (preset.hue ?? hsl.h) + recolor.hue;
  return toRgb({
    h: ((hue % 360) + 360) % 360,
    s: Math.min(1, hsl.s * preset.saturation),
    l: Math.min(1, hsl.l * preset.lightness),
  });
}

/** Every opaque pixel of RGBA data, recolored in place. */
export function recolorPixels({
  data,
  recolor,
}: {
  data: Uint8ClampedArray;
  recolor: Recolor;
}): void {
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) === 0) continue;
    const [r, g, b] = recolorRgb({
      rgb: [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0],
      recolor,
    });
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
}

/** The nearest CSS filter, for portraits drawn in the page rather than by the game. */
export function recolorFilter(recolor: Recolor | undefined): string {
  if (!recolor || isPlain(recolor)) return '';
  const parts = recolor.hue === 0 ? [] : [`hue-rotate(${recolor.hue}deg)`];
  switch (recolor.preset) {
    case 'gold':
      parts.push('sepia(1)', 'saturate(1.6)');
      break;
    case 'frost':
      parts.push('sepia(1)', 'hue-rotate(160deg)', 'saturate(0.9)', 'brightness(1.1)');
      break;
    case 'ember':
      parts.push('sepia(1)', 'hue-rotate(-30deg)', 'saturate(2)');
      break;
    case 'verdant':
      parts.push('sepia(1)', 'hue-rotate(60deg)', 'saturate(1.5)');
      break;
    case 'shadow':
      parts.push('saturate(0.35)', 'brightness(0.6)');
      break;
    case 'none':
      break;
  }
  return parts.join(' ');
}

let current: RecolorMap = {};

/** Follows the snapshot's recolors; called on every snapshot. */
export function setRecolor(map: RecolorMap | undefined): void {
  current = map ?? {};
}

/** The recolor for `class:<id>` or `councillor:<id>`, if any. */
export function recolorOf(target: string): Recolor | undefined {
  return current[target];
}

/**
 * A recolored copy of a character's sheet and its animations (`<key>:<animation>`), made once and
 * kept; the key itself when there's nothing to change.
 */
export function recoloredCharacter({
  scene,
  key,
  recolor,
}: {
  scene: Phaser.Scene;
  key: string;
  recolor: Recolor | undefined;
}): string {
  if (!recolor || isPlain(recolor) || !scene.textures.exists(key)) return key;
  const copy = `${key}~${recolor.hue}~${recolor.preset}`;
  if (scene.textures.exists(copy)) return copy;
  const texture = scene.textures.get(key);
  const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) return key;
  context.drawImage(source, 0, 0);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  recolorPixels({ data: image.data, recolor });
  context.putImageData(image, 0, 0);
  const frame = texture.get(0);
  scene.textures.addSpriteSheet(copy, canvas as unknown as HTMLImageElement, {
    frameWidth: frame.width,
    frameHeight: frame.height,
  });
  for (const animation of scene.anims.toJSON().anims) {
    if (!animation.key.startsWith(`${key}:`)) continue;
    scene.anims.create({
      key: `${copy}${animation.key.slice(key.length)}`,
      frames: animation.frames.map((f) => ({ key: copy, frame: f.frame })),
      frameRate: animation.frameRate,
      repeat: animation.repeat,
    });
  }
  return copy;
}

function toHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      : max === gn
        ? ((bn - rn) / d + 2) * 60
        : ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

function toRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hn = h / 360;
  return [
    Math.round(channel(hn + 1 / 3) * 255),
    Math.round(channel(hn) * 255),
    Math.round(channel(hn - 1 / 3) * 255),
  ];
}
