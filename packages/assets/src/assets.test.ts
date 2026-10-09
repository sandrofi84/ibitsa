import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDefaultPack, engineFiles } from './generate.ts';
import type { Manifest } from './manifest.schema.ts';
import { SOUND_LIMITS, SOUND_SLOTS } from './manifest.ts';
import { Raster } from './raster.ts';
import { defaultSounds, synth, wav, wavSeconds } from './sound.ts';
import { rasterizeSvg } from './svg-rasterizer.ts';
import { validatePack } from './validate.ts';

const PACK = fileURLToPath(new URL('../default-pack/', import.meta.url));
const TEXTURES = fileURLToPath(new URL('../../game/public/textures/', import.meta.url));
/** The repo's art sources, which the committed pack is built from (§9.5). */
const ART = fileURLToPath(new URL('../../../art/', import.meta.url));

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the default pack to break. */
function copyPack(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-pack-'));
  temps.push(dir);
  cpSync(PACK, dir, { recursive: true });
  return dir;
}

/** An `art/` folder with a plain 480×270 hut interior. */
function sceneArt(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-scene-art-'));
  temps.push(dir);
  mkdirSync(join(dir, 'scenes'));
  writeFileSync(
    join(dir, 'scenes', 'hut-interior.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270" shape-rendering="crispEdges"><rect width="480" height="270" fill="#ead4aa"/></svg>',
  );
  return dir;
}

function editManifest(dir: string, edit: (m: Manifest) => void): void {
  const path = join(dir, 'pack.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

describe('validatePack', () => {
  it('accepts the default pack', () => {
    const result = validatePack(PACK);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  // Copying the whole pack is slow on Windows CI (it took 5.2 s once): give it room.
  it('rejects a script file', () => {
    const dir = copyPack();
    writeFileSync(join(dir, 'characters', 'evil.js'), 'alert(1)');
    expect(validatePack(dir)).toEqual({
      ok: false,
      errors: ['characters/evil.js: not allowed in a pack (images, audio and pack.json only)'],
    });
  }, 20_000);

  it('rejects a missing required animation', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      delete m.characters['hero.ranger']?.animations.walk;
    });
    expect(validatePack(dir)).toEqual({
      ok: false,
      errors: ['character hero.ranger: missing required animation "walk"'],
    });
  });

  it('rejects a pack missing an activity icon, or with icons of the wrong size (#60)', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      m.activityIcons.kinds = m.activityIcons.kinds.filter((k) => k !== 'test');
      m.activityIcons.size = 16;
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual(
      expect.arrayContaining([
        'activity icons: size 16, expected 12',
        'activity icons: missing "test"',
        'activity icons: ui/activity-icons.png is 84×12, expected 96×16',
      ]),
    );
  });

  it('has a drawbridge (lowered and raised) and map markers in the default pack (#124)', () => {
    const { manifest } = buildDefaultPack();
    expect(manifest.bridge).toEqual({
      image: 'map/bridge.png',
      end: 8,
      segment: 32,
      height: 24,
      frames: ['lowered', 'raised'],
    });
    expect(manifest.markers).toEqual({
      image: 'ui/markers.png',
      size: 12,
      kinds: ['padlock', 'behind', 'magnifier', 'hourglass'],
    });
  });

  it("asks a pack's markers for the padlock and the behind mark only: the game draws the review ones (#140)", () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      if (m.markers) m.markers.kinds = ['magnifier', 'hourglass', 'magnifier', 'hourglass'];
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual([
      'markers: missing "padlock"',
      'markers: missing "behind"',
    ]);
  }, 20_000);

  it('accepts a pack without a drawbridge or markers: the game draws its own (#124)', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      delete m.bridge;
      delete m.markers;
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('rejects a drawbridge or markers of the wrong size or missing a frame (#124)', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      if (m.bridge) {
        m.bridge.segment = 16;
        m.bridge.frames = ['lowered'];
      }
      if (m.markers) {
        m.markers.size = 16;
        m.markers.kinds = ['padlock'];
      }
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual([
      'bridge: pieces must be 24 tall with ends of 8 and a segment of 32',
      'bridge: missing frame "raised"',
      'bridge: map/bridge.png is 48×48, expected 32×24',
      'markers: size 16, expected 12',
      'markers: missing "behind"',
      'markers: ui/markers.png is 48×12, expected 16×16',
    ]);
  });

  it('rejects a wrong frame size', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      const rogue = m.characters['hero.rogue'];
      if (rogue) rogue.frame = { width: 32, height: 32 };
    });
    const result = validatePack(dir);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContain(
      'character hero.rogue: frame is 32×32, expected 16×16',
    );
  });

  it('gives the default councillors a 48×48 full-body council sheet and the heroes none (§9.2, #219)', () => {
    const { manifest } = buildDefaultPack();
    const elder = manifest.characters['councillor.elder']?.council;
    expect(elder?.frame).toEqual({ width: 48, height: 48 });
    expect(Object.keys(elder?.animations ?? {})).toEqual([
      'idle',
      'talk',
      'think',
      'raiseHand',
      'write',
      'walk',
    ]);
    expect(manifest.characters['hero.ranger']?.council).toBeUndefined();
  });

  it('accepts a pack without council sheets: the hut scales the map sheet up', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      for (const c of Object.values(m.characters)) delete c.council;
    });
    expect(validatePack(dir)).toMatchObject({ ok: true });
  });

  it('rejects a council sheet with the wrong frame size or a missing animation', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      const council = m.characters['councillor.default']?.council;
      if (!council) throw new Error('no council sheet');
      council.frame = { width: 16, height: 16 };
      delete council.animations.raiseHand;
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual([
      'character councillor.default council sheet: frame is 16×16, expected 48×48 (council figures are 48×48 full-body; redraw the sheet, or remove "council" to use the map sprite scaled 3×)',
      'character councillor.default council sheet: missing required animation "raiseHand"',
    ]);
  });

  it('accepts a council sheet without the walk-in: the hut slides that councillor to its seat (#219)', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      const council = m.characters['councillor.default']?.council;
      if (!council) throw new Error('no council sheet');
      delete council.animations.walk;
    });
    expect(validatePack(dir)).toMatchObject({ ok: true });
  });

  it('rejects a council sheet image too small for its animations', () => {
    const dir = copyPack();
    cpSync(
      join(dir, 'characters', 'councillor-default.png'),
      join(dir, 'characters', 'councillor-default-council.png'),
    );
    expect(validatePack(dir)).toEqual({
      ok: false,
      errors: [
        'character councillor.default council sheet: characters/councillor-default-council.png is 64×64, too small or not a whole number of 48×48 frames for its animations',
      ],
    });
  });

  it('accepts the hut scenes at 480×270 and rejects any other size or a missing file (#219)', () => {
    const scene = (dir: string) => {
      const png = buildDefaultPack({
        art: {
          dir: sceneArt(),
          rasterize: rasterizeSvg,
        },
      }).files['scenes/hut-interior.png'] as Buffer;
      writeFileSync(join(dir, 'hut-interior.png'), png);
    };
    const good = copyPack();
    scene(good);
    editManifest(good, (m) => {
      m.scenes = { hutInterior: 'hut-interior.png' };
    });
    expect(validatePack(good)).toMatchObject({ ok: true });

    const bad = copyPack();
    cpSync(join(bad, 'map', 'hut.png'), join(bad, 'table.png'));
    editManifest(bad, (m) => {
      m.scenes = { hutTable: 'table.png', hutInterior: 'nowhere.png' };
    });
    expect(validatePack(bad)).toEqual({
      ok: false,
      errors: [
        'scene hutInterior: nowhere.png is missing',
        'scene hutTable: table.png is 64×64, expected 480×270',
      ],
    });
  });

  it('builds Home Village and Ibitsa from art, and accepts them only at their sizes (#221)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibitsa-scene-art-'));
    temps.push(dir);
    mkdirSync(join(dir, 'scenes'));
    writeFileSync(
      join(dir, 'scenes', 'village.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96" viewBox="0 0 128 96" shape-rendering="crispEdges"><rect width="128" height="64" fill="#63c74d"/></svg>',
    );
    writeFileSync(
      join(dir, 'scenes', 'ibitsa.grid'),
      `size 48x32\n---\n${`${'k'.repeat(48)}\n`.repeat(32)}`,
    );
    const built = buildDefaultPack({ art: { dir, rasterize: rasterizeSvg } });
    expect(built.manifest.scenes).toEqual({
      village: 'scenes/village.png',
      ibitsa: 'scenes/ibitsa.png',
    });
    const good = copyPack();
    // The default pack may already have scenes of its own (the hut's, #223).
    mkdirSync(join(good, 'scenes'), { recursive: true });
    for (const name of ['village', 'ibitsa'])
      writeFileSync(
        join(good, 'scenes', `${name}.png`),
        built.files[`scenes/${name}.png`] as Buffer,
      );
    editManifest(good, (m) => {
      m.scenes = built.manifest.scenes;
    });
    expect(validatePack(good)).toMatchObject({ ok: true, warnings: [] });

    const bad = copyPack();
    editManifest(bad, (m) => {
      m.scenes = { village: 'map/hut.png', ibitsa: 'map/hut.png' };
    });
    expect(validatePack(bad)).toEqual({
      ok: false,
      errors: [
        'scene village: map/hut.png is 64×64, expected 128×96',
        'scene ibitsa: map/hut.png is 64×64, expected 48×32',
      ],
    });
  });

  it('still accepts an older pack listing the tiles the game never drew, with a warning (#221)', () => {
    const dir = copyPack();
    writeFileSync(join(dir, 'map', 'tiles.png'), new Raster(8 * 16, 16).png());
    editManifest(dir, (m) => {
      m.tiles.tiles = {
        water: { index: 0, frames: 4 },
        grass: { index: 4 },
        sand: { index: 5 },
        shore: { index: 6 },
        pathDot: { index: 7 },
      };
    });
    expect(validatePack(dir)).toMatchObject({
      ok: true,
      warnings: ['tiles: grass, sand, shore, pathDot are no longer used; only water is drawn'],
    });
    expect(validatePack(PACK)).toMatchObject({ ok: true, warnings: [] });
  });

  it('rejects images whose size does not match the manifest', () => {
    const dir = copyPack();
    cpSync(join(dir, 'map', 'hut.png'), join(dir, 'map', 'island.png'));
    expect(validatePack(dir)).toEqual({
      ok: false,
      errors: ['island: map/island.png is 64×64, expected 128×96'],
    });
  });

  it('rejects paths that leave the pack', () => {
    const dir = copyPack();
    editManifest(dir, (m) => {
      m.tiles.image = '../outside.png';
    });
    expect(validatePack(dir).ok).toBe(false);
  });
});

describe('regenerating', () => {
  it('produces exactly the committed default pack', () => {
    const { manifest, files } = buildDefaultPack({ art: { dir: ART, rasterize: rasterizeSvg } });
    const committed = readdirSync(PACK, { recursive: true, withFileTypes: true })
      .filter((e) => !e.isDirectory())
      // Pack paths use / on every OS.
      .map((e) => join(e.parentPath, e.name).slice(PACK.length).replaceAll('\\', '/'))
      .sort();
    expect(committed).toEqual([...Object.keys(files), 'pack.json'].sort());
    for (const [path, bytes] of Object.entries(files)) {
      expect(readFileSync(join(PACK, path)).equals(bytes), path).toBe(true);
    }
    expect(readFileSync(join(PACK, 'pack.json'), 'utf8')).toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  });

  it('produces exactly the committed engine textures and font', () => {
    for (const [name, content] of Object.entries(engineFiles())) {
      expect(readFileSync(join(TEXTURES, name)).equals(Buffer.from(content)), name).toBe(true);
    }
  });
});

describe('sounds (#184)', () => {
  it('generates every default cue as a short PCM WAV, and none of the music', () => {
    const sounds = defaultSounds();
    expect(Object.keys(sounds).sort()).toEqual(
      SOUND_SLOTS.filter((s) => !s.startsWith('music')).sort(),
    );
    for (const samples of Object.values(sounds)) {
      const seconds = wavSeconds(wav(samples));
      expect(seconds).toBeGreaterThan(0);
      expect(seconds).toBeLessThanOrEqual(SOUND_LIMITS.cueSeconds);
    }
    expect(wavSeconds(wav(synth([{ wave: 'noise', freq: 1, seconds: 0.5 }])))).toBeCloseTo(0.5, 2);
  });

  it('reads no length from what is not a PCM WAV', () => {
    expect(wavSeconds(new Uint8Array(10))).toBeNull();
    expect(
      wavSeconds(new TextEncoder().encode('RIFF....WAVEjunkjunkjunkjunkjunkjunkjunkjunkjunk')),
    ).toBeNull();
  });

  it('refuses a missing sound, one too long, and one that is not a WAV inside', () => {
    const dir = copyPack();
    writeFileSync(
      join(dir, 'sounds', 'long.wav'),
      wav(synth([{ wave: 'square', freq: 440, seconds: 4 }])),
    );
    writeFileSync(join(dir, 'sounds', 'fake.wav'), 'not a wav at all');
    editManifest(dir, (m) => {
      m.sounds = {
        ...m.sounds,
        needsYou: { file: 'sounds/nope.wav' },
        taskDone: { file: 'sounds/long.wav' },
        prOpened: { file: 'sounds/fake.wav' },
      };
    });
    const result = validatePack(dir);
    expect(result.ok ? [] : result.errors).toEqual([
      'sound needsYou: sounds/nope.wav is missing',
      'sound taskDone: 4.0 s, at most 3 s',
      'sound prOpened: sounds/fake.wav is not a PCM WAV',
    ]);
  });
});
