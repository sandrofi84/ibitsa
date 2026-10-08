import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { artSlots } from './art-slots.ts';
import {
  applyArtSources,
  ENDESGA_32,
  nearestColor,
  parseGrid,
  readSource,
  renderSvg,
} from './art-source.ts';
import { buildDefaultPack } from './generate.ts';
import { readPngSize } from './png.ts';
import { hex, type Raster } from './raster.ts';
import { rasterizeSvg } from './svg-rasterizer.ts';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An `art/` folder with these sources in it. */
function artDir(sources: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-art-'));
  temps.push(dir);
  for (const [path, content] of Object.entries(sources)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

const pixel = (raster: Raster, { x, y }: { x: number; y: number }) => [
  ...raster.data.subarray((y * raster.width + x) * 4, (y * raster.width + x) * 4 + 4),
];

/** Our PNGs' pixels (8-bit RGBA, no filtering), to look inside what the pack wrote. */
function decodePng(png: Buffer): { width: number; rgba: Buffer } {
  const size = readPngSize(png);
  if (!size) throw new Error('not a PNG');
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length; ) {
    const length = png.readUInt32BE(o);
    if (png.toString('ascii', o + 4, o + 8) === 'IDAT')
      idat.push(png.subarray(o + 8, o + 8 + length));
    o += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = size.width * 4;
  const rgba = Buffer.alloc(size.height * stride);
  for (let y = 0; y < size.height; y++)
    raw.copy(rgba, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  return { width: size.width, rgba };
}

const pngPixel = (png: Buffer, { x, y }: { x: number; y: number }) => {
  const { width, rgba } = decodePng(png);
  return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
};

const RED = [...hex('#be4a2f')];
const WHITE = [...hex('#ffffff')];
const CLEAR = [0, 0, 0, 0];

describe('parseGrid (§9.5, #218)', () => {
  it('reads frames of palette codes, with comments, a header comment and trailing blank lines', () => {
    const { frame, frames } = parseGrid({
      file: 'art/x.grid',
      text: '# a test\nsize 3x2   # width x height\nframes 2\n\n---\n0.j\n...\n---\n# second\n...\nv0.\n\n',
    });
    expect(frame).toEqual({ width: 3, height: 2 });
    expect(frames).toHaveLength(2);
    const [first, second] = frames as [Raster, Raster];
    expect(pixel(first, { x: 0, y: 0 })).toEqual(RED);
    expect(pixel(first, { x: 1, y: 0 })).toEqual(CLEAR);
    expect(pixel(first, { x: 2, y: 0 })).toEqual(WHITE);
    expect(pixel(second, { x: 0, y: 1 })).toEqual([...hex(ENDESGA_32[31])]);
    expect(pixel(second, { x: 1, y: 1 })).toEqual(RED);
  });

  it.each([
    ['frames 1\n---\n0\n', 'art/x.grid: line 2: a frame starts before the `size` line'],
    ['size 2x1\n', 'art/x.grid: frames: has 0 frame(s), expected 1'],
    ['', 'art/x.grid: header: no `size WxH` line'],
    [
      'size 2x1\ncolours 3\n---\n00\n',
      'art/x.grid: line 2: expected `size WxH` or `frames N`, found "colours 3"',
    ],
    ['size 2x1\n---\n000\n', 'art/x.grid: frame 1, line 3: a row is 3 wide, expected 2'],
    [
      'size 2x1\n---\n0w\n',
      'art/x.grid: frame 1, line 3: "w" is not a palette code (0-9, a-v) or "."',
    ],
    ['size 2x2\n---\n00', 'art/x.grid: frame 1 (line 2): has 1 rows, expected 2'],
    ['size 2x1\nframes 2\n---\n00\n', 'art/x.grid: frames: has 1 frame(s), expected 2'],
  ])('refuses %j, naming where', (text, message) => {
    expect(() => parseGrid({ text, file: 'art/x.grid' })).toThrow(message);
  });
});

const svg = (body: string, { width = 4, height = 2 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${body}</svg>`;

describe('renderSvg (§9.5, #218)', () => {
  it('renders at its size and snaps every pixel to the palette, dropping under half opacity', () => {
    const raster = renderSvg({
      rasterize: rasterizeSvg,
      file: 'art/x.svg',
      size: { width: 4, height: 2 },
      svg: svg(
        '<rect x="0" y="0" width="2" height="2" fill="#c04b30"/>' +
          '<rect x="2" y="0" width="1" height="1" fill="#fafafa" fill-opacity="0.6"/>' +
          '<rect x="3" y="0" width="1" height="1" fill="#ffffff" fill-opacity="0.3"/>',
      ),
    });
    expect(pixel(raster, { x: 1, y: 1 })).toEqual(RED);
    expect(pixel(raster, { x: 2, y: 0 })).toEqual(WHITE);
    expect(pixel(raster, { x: 3, y: 0 })).toEqual(CLEAR);
    expect(pixel(raster, { x: 3, y: 1 })).toEqual(CLEAR);
  });

  it('refuses another size or viewBox, and what the art guide forbids', () => {
    const size = { width: 4, height: 2 };
    expect(() =>
      renderSvg({ file: 'art/x.svg', size, rasterize: rasterizeSvg, svg: svg('', { width: 8 }) }),
    ).toThrow('art/x.svg: is 8x2 (viewBox "0 0 8 2"), expected 4x2 with viewBox "0 0 W H"');
    expect(() =>
      renderSvg({ file: 'art/x.svg', size, rasterize: rasterizeSvg, svg: '<g/>' }),
    ).toThrow('art/x.svg: no <svg> element');
    expect(() =>
      renderSvg({
        file: 'art/x.svg',
        size,
        svg: svg('<linearGradient id="g"/><rect width="4" height="2"/>'),
      }),
    ).toThrow("art/x.svg: uses <linearGradient>, which the art guide doesn't allow");
  });

  it('needs the generator’s renderer to build an SVG', () => {
    expect(() =>
      renderSvg({ file: 'art/x.svg', size: { width: 4, height: 2 }, svg: svg('') }),
    ).toThrow('art/x.svg: building an SVG needs the generator’s renderer');
  });

  it('snaps to the nearest palette colour', () => {
    expect(nearestColor([0, 0, 0, 255])).toEqual(hex('#181425'));
    expect(nearestColor([250, 250, 250, 255])).toEqual(hex('#ffffff'));
  });
});

describe('readSource (§9.5, #218)', () => {
  const piece = { source: 'map/x', x: 0, y: 0, frame: { width: 2, height: 1 }, frames: 2 };

  it('lays a grid’s frames side by side, or renders an SVG strip; nothing without a source', () => {
    const grid = readSource({
      sources: {
        dir: artDir({ 'map/x.grid': 'size 2x1\nframes 2\n---\n0.\n---\n.j\n' }),
        rasterize: rasterizeSvg,
      },
      piece,
    });
    expect(
      grid && [
        pixel(grid, { x: 0, y: 0 }),
        pixel(grid, { x: 1, y: 0 }),
        pixel(grid, { x: 3, y: 0 }),
      ],
    ).toEqual([RED, CLEAR, WHITE]);
    const drawn = readSource({
      sources: {
        dir: artDir({
          'map/x.svg': svg('<rect x="3" y="0" width="1" height="1" fill="#ffffff"/>', {
            width: 4,
            height: 1,
          }),
        }),
        rasterize: rasterizeSvg,
      },
      piece,
    });
    expect(drawn && pixel(drawn, { x: 3, y: 0 })).toEqual(WHITE);
    expect(readSource({ sources: { dir: artDir({}), rasterize: rasterizeSvg }, piece })).toBeNull();
  });

  it('refuses two sources for a piece, and a grid of the wrong frame size or count', () => {
    expect(() =>
      readSource({
        sources: { dir: artDir({ 'map/x.grid': '', 'map/x.svg': '' }), rasterize: rasterizeSvg },
        piece,
      }),
    ).toThrow('art/map/x.grid and art/map/x.svg: a piece takes one source, not both');
    expect(() =>
      readSource({
        sources: {
          dir: artDir({ 'map/x.grid': 'size 3x1\nframes 2\n---\n000\n---\n000\n' }),
          rasterize: rasterizeSvg,
        },
        piece,
      }),
    ).toThrow('art/map/x.grid: frames are 3x1, expected 2x1');
    expect(() =>
      readSource({
        sources: { dir: artDir({ 'map/x.grid': 'size 2x1\n---\n00\n' }), rasterize: rasterizeSvg },
        piece,
      }),
    ).toThrow('art/map/x.grid: has 1 frame(s), expected 2');
  });
});

describe('the default pack from art sources (§9.5, #218)', () => {
  const placeholder = buildDefaultPack();

  it('every slot is an image in the pack, and every piece fits inside it', () => {
    for (const slot of artSlots()) {
      const png = placeholder.files[slot.output];
      expect(png, slot.output).toBeDefined();
      const size = readPngSize(png as Buffer);
      for (const p of slot.pieces) {
        expect(p.x + p.frame.width * p.frames, p.source).toBeLessThanOrEqual(size?.width ?? 0);
        expect(p.y + p.frame.height, p.source).toBeLessThanOrEqual(size?.height ?? 0);
      }
    }
  });

  it('replaces a piece with its art, transparency included, and keeps every other placeholder', () => {
    const water = `size 16x16\nframes 4\n${`---\n${`${'j'.repeat(15)}.\n`.repeat(16)}`.repeat(4)}`;
    const built = buildDefaultPack({ art: { dir: artDir({ 'map/water.grid': water }) } });
    const tiles = built.files['map/tiles.png'] as Buffer;
    expect(pngPixel(tiles, { x: 0, y: 0 })).toEqual(WHITE);
    expect(pngPixel(tiles, { x: 15, y: 3 })).toEqual(CLEAR);
    expect(pngPixel(tiles, { x: 63, y: 15 })).toEqual(CLEAR);
    // Past the water's four frames, the strip is still the placeholder's.
    expect(pngPixel(tiles, { x: 70, y: 8 })).toEqual(
      pngPixel(placeholder.files['map/tiles.png'] as Buffer, { x: 70, y: 8 }),
    );
    for (const [path, bytes] of Object.entries(placeholder.files))
      if (path !== 'map/tiles.png') expect(built.files[path]?.equals(bytes), path).toBe(true);
  });

  it('refuses a slot for an image the pack doesn’t have', () => {
    expect(() =>
      applyArtSources({
        images: {},
        sources: { dir: artDir({}) },
        slots: [{ output: 'map/nope.png', pieces: [] }],
      }),
    ).toThrow('art slot map/nope.png: the pack has no such image');
  });

  it('builds the same bytes every time', () => {
    const dir = artDir({
      'portraits/hero-paladin.svg': svg('<circle cx="32" cy="32" r="20" fill="#feae34"/>', {
        width: 64,
        height: 64,
      }),
    });
    const once = buildDefaultPack({ art: { dir, rasterize: rasterizeSvg } }).files[
      'portraits/hero-paladin.png'
    ] as Buffer;
    const again = buildDefaultPack({ art: { dir, rasterize: rasterizeSvg } }).files[
      'portraits/hero-paladin.png'
    ] as Buffer;
    expect(once.equals(again)).toBe(true);
    expect(pngPixel(once, { x: 32, y: 32 })).toEqual([...hex('#feae34')]);
    expect(pngPixel(once, { x: 0, y: 0 })).toEqual(CLEAR);
  });
});
