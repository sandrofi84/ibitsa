import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionInfo } from '@ibitsa/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillCatalog, watchFolder } from './skill-catalog';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = (withClaude: boolean) => {
  const d = mkdtempSync(join(tmpdir(), 'ibitsa-catalog-'));
  dirs.push(d);
  if (withClaude) mkdirSync(join(d, '.claude'));
  return d;
};
const action = (name: string): ActionInfo => ({
  name,
  description: '',
  argumentHint: '',
  aliases: [],
  source: 'project',
  target: 'any',
});

describe('SkillCatalog (#84)', () => {
  it('lists once per folder, and again after a watched folder changes', async () => {
    const cwd = temp(true);
    const home = temp(true);
    let calls = 0;
    const watchers: { dir: string; fire: () => void; closed: boolean }[] = [];
    const changed: string[] = [];
    const catalog = new SkillCatalog<ActionInfo>({
      list: async () => [action(`v${++calls}`)],
      home,
      watch: ({ dir, onChange }) => {
        const w = { dir, fire: onChange, closed: false };
        watchers.push(w);
        return { close: () => (w.closed = true) };
      },
      onChange: (c) => changed.push(c),
    });
    expect(await catalog.list(cwd)).toEqual([action('v1')]);
    expect(await catalog.list(cwd)).toEqual([action('v1')]);
    expect(watchers.map((w) => w.dir)).toEqual([join(cwd, '.claude'), join(home, '.claude')]);
    watchers[0]?.fire();
    expect(changed).toEqual([cwd]);
    expect(await catalog.list(cwd)).toEqual([action('v2')]);
    expect(watchers).toHaveLength(2);
    catalog.dispose();
    expect(watchers.every((w) => w.closed)).toBe(true);
  });

  it("doesn't keep a failed listing, and watches only folders that exist", async () => {
    const cwd = temp(false);
    let fail = true;
    const watched: string[] = [];
    const catalog = new SkillCatalog<ActionInfo>({
      list: async () => {
        if (fail) throw new Error('no CLI');
        return [action('ok')];
      },
      home: temp(false),
      watch: ({ dir }) => {
        watched.push(dir);
        return { close: () => {} };
      },
      onChange: () => {},
    });
    await expect(catalog.list(cwd)).rejects.toThrow('no CLI');
    fail = false;
    expect(await catalog.list(cwd)).toEqual([action('ok')]);
    expect(watched).toEqual([]);
  });

  it("Node's watcher reports a change inside the folder, and stops when closed", async () => {
    const dir = temp(true);
    let changes = 0;
    const w = watchFolder({ dir, onChange: () => changes++ });
    // A new watcher can miss the first changes (macOS under load): keep changing until one is seen.
    let n = 0;
    await vi.waitFor(
      () => {
        mkdirSync(join(dir, `skill-${++n}`));
        expect(changes).toBeGreaterThan(0);
      },
      { timeout: 5_000, interval: 100 },
    );
    w.close();
    expect(watchFolder({ dir: join(dir, 'missing'), onChange: () => {} }).close()).toBeUndefined();
  });
});
