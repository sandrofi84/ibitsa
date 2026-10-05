import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { engineTextures } from './art.ts';
import { buildDefaultPack } from './generate.ts';
import type { Manifest } from './manifest.schema.ts';
import { validatePack } from './validate.ts';

const PACK = fileURLToPath(new URL('../default-pack/', import.meta.url));
const TEXTURES = fileURLToPath(new URL('../../game/public/textures/', import.meta.url));

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

  it('rejects a script file', () => {
    const dir = copyPack();
    writeFileSync(join(dir, 'characters', 'evil.js'), 'alert(1)');
    expect(validatePack(dir)).toEqual({
      ok: false,
      errors: ['characters/evil.js: not allowed in a pack (images, audio and pack.json only)'],
    });
  });

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
    const { manifest, files } = buildDefaultPack();
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

  it('produces exactly the committed engine textures', () => {
    for (const [name, raster] of Object.entries(engineTextures())) {
      expect(readFileSync(join(TEXTURES, name)).equals(raster.png()), name).toBe(true);
    }
  });
});
