import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PackLibrary } from './packs';

const DEFAULT_PACK = join(__dirname, '..', '..', 'assets', 'default-pack');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A home and a workspace, each with a packs folder: a good pack (the default's copy) and a broken one. */
function folders() {
  const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'ibitsa-ws-'));
  dirs.push(home, workspace);
  const good = join(home, '.ibitsa', 'packs', 'retro');
  cpSync(DEFAULT_PACK, good, { recursive: true });
  writeFileSync(
    join(good, 'pack.json'),
    JSON.stringify({
      ...JSON.parse(readFileSync(join(DEFAULT_PACK, 'pack.json'), 'utf8')),
      name: 'retro',
    }),
  );
  const broken = join(workspace, '.ibitsa', 'packs', 'broken');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'pack.json'), JSON.stringify({ name: 'Half done' }));
  return { home, workspace, good, broken };
}

describe('PackLibrary (#183)', () => {
  it("finds the default, the user's packs and the project's, with their errors", () => {
    const { home, workspace } = folders();
    const packs = new PackLibrary({ home, workspace, url: (p) => `url:${p}` }).list();
    expect(packs.map(({ id, name, scope }) => ({ id, name, scope }))).toEqual([
      { id: 'default', name: 'Default', scope: 'builtin' },
      { id: 'user:retro', name: 'retro', scope: 'user' },
      { id: 'project:broken', name: 'Half done', scope: 'project' },
    ]);
    expect(packs[1]?.errors).toEqual([]);
    expect(packs[1]?.preview).toMatchObject({
      sheet: expect.stringMatching(/^url:.*retro/),
      frameWidth: 16,
    });
    expect(packs[2]?.errors.length).toBeGreaterThan(0);
    expect(packs[2]?.preview).toBeNull();
  });

  it('gives the folder only of a pack that can be used', () => {
    const { home, workspace, good } = folders();
    const library = new PackLibrary({ home, workspace, url: (p) => p });
    expect(library.dir('user:retro')).toBe(good);
    expect(library.dir('project:broken')).toBeNull();
    expect(library.dir('default')).toBeNull();
    expect(library.dir('user:nope')).toBeNull();
    expect(library.roots()).toEqual([
      join(home, '.ibitsa', 'packs'),
      join(workspace, '.ibitsa', 'packs'),
    ]);
  });

  it("passes on a usable pack's warnings, and still gives its folder (#235)", () => {
    const { home, workspace, good } = folders();
    // An older pack that still lists a tile the game no longer draws.
    const manifest = JSON.parse(readFileSync(join(good, 'pack.json'), 'utf8'));
    manifest.tiles.tiles.grass = { index: 1 };
    writeFileSync(join(good, 'pack.json'), JSON.stringify(manifest));
    const library = new PackLibrary({ home, workspace, url: (p) => p });
    const retro = library.list().find((p) => p.id === 'user:retro');
    expect(retro?.errors).toEqual([]);
    expect(retro?.warnings).toEqual(['tiles: grass is no longer used; only water is drawn']);
    expect(library.dir('user:retro')).toBe(good);
    // The default and a broken pack carry none.
    expect(library.list().find((p) => p.id === 'default')?.warnings).toEqual([]);
    expect(library.list().find((p) => p.id === 'project:broken')?.warnings).toEqual([]);
  });

  it('has only the default without pack folders or a workspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-empty-'));
    dirs.push(home);
    const library = new PackLibrary({ home, workspace: undefined, url: (p) => p });
    expect(library.list().map((p) => p.id)).toEqual(['default']);
    expect(library.roots()).toEqual([join(home, '.ibitsa', 'packs')]);
  });
});
