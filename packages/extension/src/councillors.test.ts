import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAdapter } from '@ibitsa/agent-claude-sdk';
import { buildDefaultPack } from '@ibitsa/assets';
import { afterEach, describe, expect, it } from 'vitest';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Ibitsa's built-in councillors (#98)", () => {
  it('each have their own look in the default pack: map sheet, council figure and portrait (#220)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ibitsa-empty-'));
    dirs.push(empty);
    const plugin = join(__dirname, '..', 'plugin');
    const adapter = new ClaudeAdapter({ env: () => ({}), home: empty, pluginDirs: () => [plugin] });
    const councillors = await adapter.listCouncillors({ cwd: empty });
    const { manifest } = buildDefaultPack();
    expect(councillors).toHaveLength(5);
    for (const c of councillors) {
      // No skill names another look, so the game draws `councillor.<id>` (the game's sitting-hut rule).
      expect(c.portrait, c.id).toBeNull();
      const look = manifest.characters[`councillor.${c.id}`];
      expect(look?.role, c.id).toBe('councillor');
      expect(look?.portrait, c.id).toBe(`portraits/councillor-${c.id}.png`);
      expect(look?.council?.frame, c.id).toEqual({ width: 48, height: 48 });
    }
  });

  it('are the v1 roster, each with planning and review advice, read-only and kept out of the hero menu', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ibitsa-empty-'));
    dirs.push(empty);
    const plugin = join(__dirname, '..', 'plugin');
    const adapter = new ClaudeAdapter({ env: () => ({}), home: empty, pluginDirs: () => [plugin] });
    const councillors = await adapter.listCouncillors({ cwd: empty });
    expect(councillors.map((c) => [c.skill, c.title])).toEqual([
      ['ibitsa:accessibility', 'Accessibility'],
      ['ibitsa:architect', 'Architect'],
      ['ibitsa:designer', 'Designer'],
      ['ibitsa:security', 'Security'],
      ['ibitsa:tester', 'Tester'],
    ]);
    for (const c of councillors) {
      expect(c).toMatchObject({
        source: 'builtin',
        tools: ['Read', 'Grep', 'Glob'],
        modes: { planning: true, review: true },
      });
      expect(c.description).not.toBe('');
    }
    for (const c of councillors) {
      const text = readFileSync(join(plugin, 'skills', c.id, 'SKILL.md'), 'utf8');
      expect(text).toContain('disable-model-invocation: true');
      expect(text).toContain('ibitsa-target: council');
    }
  });
});
