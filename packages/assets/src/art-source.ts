import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtPiece, ArtSlot, ArtSources, FrameSize, RasterizeSvg } from './art-source.types.ts';
import { hex, Raster } from './raster.ts';
import type { Rgba } from './raster.types.ts';

// Art sources (spec §9.5, #218): the real art lives in the repo's `art/` folder as pixel grids in
// text (`.grid`) or SVG (`.svg`), and the default pack is built from them. The formats are the ones
// `docs/art` describes; every colour is one of Endesga 32's.

/** Endesga 32, in Lospec's order: a grid writes colour n as the n-th code, `0`–`9` then `a`–`v`. */
export const ENDESGA_32 = [
  '#be4a2f',
  '#d77643',
  '#ead4aa',
  '#e4a672',
  '#b86f50',
  '#733e39',
  '#3e2731',
  '#a22633',
  '#e43b44',
  '#f77622',
  '#feae34',
  '#fee761',
  '#63c74d',
  '#3e8948',
  '#265c42',
  '#193c3e',
  '#124e89',
  '#0099db',
  '#2ce8f5',
  '#ffffff',
  '#c0cbdc',
  '#8b9bb4',
  '#5a6988',
  '#3a4466',
  '#262b44',
  '#181425',
  '#ff0044',
  '#68386c',
  '#b55088',
  '#f6757a',
  '#e8b796',
  '#c28569',
] as const;

const CODES = '0123456789abcdefghijklmnopqrstuv';
const COLORS: readonly Rgba[] = ENDESGA_32.map((c) => hex(c));
const GRID_PALETTE: Record<string, Rgba> = Object.fromEntries(
  [...CODES].map((code, i) => [code, COLORS[i] as Rgba]),
);
/** What an SVG may not use: anything that blurs or brings in pixels from outside the palette. */
const SVG_FORBIDDEN = ['linearGradient', 'radialGradient', 'filter', 'image', 'text', 'mask'];

/**
 * Reads a pixel grid: a `size WxH` line, an optional `frames N`, then each frame after a `---` line,
 * one row of palette codes (or `.` for transparent) per line. Lines starting with `#` are comments,
 * and a header line may end in one. Errors name the file, the line and the frame.
 */
export function parseGrid({ text, file }: { text: string; file: string }): {
  frame: FrameSize;
  frames: Raster[];
} {
  const fail = (where: string, message: string): never => {
    throw new Error(`${file}: ${where}: ${message}`);
  };
  let frame: FrameSize | null = null;
  let expected = 1;
  const frames: { rows: string[]; line: number }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.startsWith('#')) return;
    const content = raw.trimEnd();
    if (content === '---') {
      if (!frame) fail(`line ${line}`, 'a frame starts before the `size` line');
      frames.push({ rows: [], line });
      return;
    }
    const current = frames.at(-1);
    if (!current) {
      const header = content.replace(/#.*$/, '').trim();
      if (header === '') return;
      const size = /^size\s+(\d+)x(\d+)$/.exec(header);
      const count = /^frames\s+(\d+)$/.exec(header);
      if (size) frame = { width: Number(size[1]), height: Number(size[2]) };
      else if (count) expected = Number(count[1]);
      else fail(`line ${line}`, `expected \`size WxH\` or \`frames N\`, found "${header}"`);
      return;
    }
    // A blank line after a frame's last row (or the file's end) is spacing, not a row.
    if (content === '' && current.rows.length === frame?.height) return;
    const where = `frame ${frames.length}, line ${line}`;
    if (content.length !== frame?.width)
      fail(where, `a row is ${content.length} wide, expected ${frame?.width}`);
    const bad = [...content].find((ch) => ch !== '.' && !GRID_PALETTE[ch]);
    if (bad) fail(where, `"${bad}" is not a palette code (0-9, a-v) or "."`);
    current.rows.push(content);
  });
  if (!frame) return fail('header', 'no `size WxH` line');
  const size: FrameSize = frame;
  if (frames.length !== expected)
    fail('frames', `has ${frames.length} frame(s), expected ${expected}`);
  return {
    frame: size,
    frames: frames.map(({ rows, line }, i) => {
      if (rows.length !== size.height)
        fail(`frame ${i + 1} (line ${line})`, `has ${rows.length} rows, expected ${size.height}`);
      const raster = new Raster(size.width, size.height);
      raster.pattern({ x: 0, y: 0, rows, palette: GRID_PALETTE });
      return raster;
    }),
  };
}

/**
 * Renders an SVG at exactly its size, then snaps every pixel to Endesga 32: under half opacity is
 * transparent, anything else becomes the nearest palette colour.
 */
export function renderSvg({
  svg,
  file,
  size,
  rasterize,
}: {
  svg: string;
  file: string;
  size: FrameSize;
  rasterize?: RasterizeSvg | undefined;
}): Raster {
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message}`);
  };
  const root = /<svg\b[^>]*>/.exec(svg)?.[0] ?? fail('no <svg> element');
  const attribute = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(root)?.[1];
  const declared = `${attribute('width')}x${attribute('height')} (viewBox "${attribute('viewBox')}")`;
  if (
    attribute('width') !== String(size.width) ||
    attribute('height') !== String(size.height) ||
    attribute('viewBox')?.trim().split(/\s+/).join(' ') !== `0 0 ${size.width} ${size.height}`
  )
    fail(`is ${declared}, expected ${size.width}x${size.height} with viewBox "0 0 W H"`);
  const forbidden = SVG_FORBIDDEN.find((tag) => new RegExp(`<${tag}\\b`).test(svg));
  if (forbidden) fail(`uses <${forbidden}>, which the art guide doesn't allow`);
  if (!rasterize)
    return fail(
      'building an SVG needs the generator’s renderer: pnpm --filter @ibitsa/assets generate',
    );
  const image = rasterize(svg);
  const raster = new Raster(size.width, size.height);
  const pixels = image.pixels;
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const o = (y * size.width + x) * 4;
      const alpha = pixels[o + 3] ?? 0;
      if (alpha < 128) continue;
      // resvg's pixels are premultiplied: take the alpha back out before matching.
      const color: Rgba = [
        Math.round(((pixels[o] ?? 0) * 255) / alpha),
        Math.round(((pixels[o + 1] ?? 0) * 255) / alpha),
        Math.round(((pixels[o + 2] ?? 0) * 255) / alpha),
        255,
      ];
      raster.set({ x, y, color: nearestColor(color) });
    }
  }
  return raster;
}

/** The Endesga 32 colour nearest to `color`, by distance in RGB. */
export function nearestColor(color: Rgba): Rgba {
  let best = COLORS[0] as Rgba;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of COLORS) {
    const distance =
      (candidate[0] - color[0]) ** 2 +
      (candidate[1] - color[1]) ** 2 +
      (candidate[2] - color[2]) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A piece's art from `dir`, its frames side by side, or null when it has no source yet. A piece may
 * have a `.grid` or an `.svg`, not both; either must have the piece's frame size and frame count.
 */
export function readSource({
  sources,
  piece,
}: {
  sources: ArtSources;
  piece: ArtPiece;
}): Raster | null {
  const grid = join(sources.dir, `${piece.source}.grid`);
  const svg = join(sources.dir, `${piece.source}.svg`);
  const name = (ext: string) => `art/${piece.source}${ext}`;
  if (existsSync(grid) && existsSync(svg))
    throw new Error(`${name('.grid')} and ${name('.svg')}: a piece takes one source, not both`);
  const strip = { width: piece.frame.width * piece.frames, height: piece.frame.height };
  if (existsSync(svg))
    return renderSvg({
      svg: readFileSync(svg, 'utf8'),
      file: name('.svg'),
      size: strip,
      rasterize: sources.rasterize,
    });
  if (!existsSync(grid)) return null;
  const parsed = parseGrid({ text: readFileSync(grid, 'utf8'), file: name('.grid') });
  const { width, height } = parsed.frame;
  if (width !== piece.frame.width || height !== piece.frame.height)
    throw new Error(
      `${name('.grid')}: frames are ${width}x${height}, expected ${piece.frame.width}x${piece.frame.height}`,
    );
  if (parsed.frames.length !== piece.frames)
    throw new Error(
      `${name('.grid')}: has ${parsed.frames.length} frame(s), expected ${piece.frames}`,
    );
  const raster = new Raster(strip.width, strip.height);
  parsed.frames.forEach((frame, i) => {
    raster.paste({ src: frame, x: i * piece.frame.width, y: 0 });
  });
  return raster;
}

/**
 * Lays each slot's sources over the placeholder images (keyed by their path in the pack): a piece
 * with a source replaces its area outright, transparent pixels included; one without keeps the
 * placeholder. An optional slot has no placeholder: its image is made only when a piece has art.
 */
export function applyArtSources({
  images,
  sources,
  slots,
}: {
  images: Record<string, Raster>;
  sources: ArtSources;
  slots: readonly ArtSlot[];
}): void {
  for (const slot of slots) {
    let image = images[slot.output];
    if (!image && !slot.optional)
      throw new Error(`art slot ${slot.output}: the pack has no such image`);
    for (const piece of slot.pieces) {
      const source = readSource({ sources, piece });
      if (!source) continue;
      if (!image && slot.optional) {
        image = new Raster(slot.optional.width, slot.optional.height);
        images[slot.output] = image;
      }
      image?.paste({ src: source, x: piece.x, y: piece.y });
    }
  }
}
