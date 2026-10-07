import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { councillorTemplate, GuildCouncil } from './guild-council';
import type { GuildCouncilDeps } from './guild-council.types';
import type { SettingLayers } from './guild-settings.types';

const roots = {
  home: resolve('/home/me'),
  workspace: resolve('/ws'),
  plugin: resolve('/ext/plugin'),
};

function council(layers: Partial<Record<'council.disabled' | 'councillors', SettingLayers>> = {}) {
  const files = new Map<string, string>();
  const update = vi.fn(async () => {});
  const open = vi.fn();
  const deps: GuildCouncilDeps = {
    inspect: (key) => layers[key],
    update,
    files: {
      exists: (path) => files.has(path),
      read: (path) => files.get(path) ?? '',
      write: ({ path, text }) => {
        files.set(path, text);
      },
    },
    roots,
    open,
  };
  return { council: new GuildCouncil(deps), files, update, open };
}

describe('GuildCouncil (#181)', () => {
  it('reads who is turned off and the overrides, with the layer each comes from', () => {
    const { council: c } = council({
      'council.disabled': { defaultValue: [], globalValue: ['designer', 3] },
      councillors: {
        defaultValue: {},
        workspaceValue: { security: { title: 'Guardian' }, bad: 'x' },
      },
    });
    expect(c.view()).toEqual({
      disabled: ['designer'],
      disabledLayer: 'user',
      overrides: { security: { title: 'Guardian' } },
      overridesLayer: 'workspace',
    });
    expect(council().council.view()).toEqual({
      disabled: [],
      disabledLayer: 'default',
      overrides: {},
      overridesLayer: 'default',
    });
  });

  it('turns councillors off and on, writing the whole list as it applies now', async () => {
    const { council: c, update } = council({
      'council.disabled': { defaultValue: [], globalValue: ['designer'] },
    });
    await c.setEnabled({ id: 'security', enabled: false, layer: 'workspace' });
    await c.setEnabled({ id: 'designer', enabled: true, layer: 'user' });
    expect(update.mock.calls).toEqual([
      [{ key: 'council.disabled', value: ['designer', 'security'], layer: 'workspace' }],
      [{ key: 'council.disabled', value: [], layer: 'user' }],
    ]);
  });

  it("sets and removes a councillor's overrides, keeping everyone else's and dropping blanks", async () => {
    const { council: c, update } = council({
      councillors: { globalValue: { tester: { model: 'haiku' }, security: { title: 'Old' } } },
    });
    await c.setOverride({
      id: 'security',
      override: { title: 'Guardian', model: ' ' },
      layer: 'user',
    });
    await c.setOverride({ id: 'security', override: null, layer: 'user' });
    await c.setOverride({ id: 'tester', override: { title: '' }, layer: 'user' });
    expect(update.mock.calls).toEqual([
      [
        {
          key: 'councillors',
          value: { tester: { model: 'haiku' }, security: { title: 'Guardian' } },
          layer: 'user',
        },
      ],
      [{ key: 'councillors', value: { tester: { model: 'haiku' } }, layer: 'user' }],
      [{ key: 'councillors', value: { security: { title: 'Old' } }, layer: 'user' }],
    ]);
    const { council: lonely, update: lonelyUpdate } = council({
      councillors: { globalValue: { security: { title: 'Old' } } },
    });
    await lonely.setOverride({ id: 'security', override: null, layer: 'user' });
    expect(lonelyUpdate).toHaveBeenCalledWith({
      key: 'councillors',
      value: undefined,
      layer: 'user',
    });
  });

  it("copies a councillor's skill to your skills or the project's, never overwriting, and opens it", () => {
    const { council: c, files, open } = council();
    const builtin = join(roots.plugin, 'skills', 'security', 'SKILL.md');
    files.set(builtin, '---\nname: security\n---\nBuilt-in.');
    const mine = join(roots.home, '.claude', 'skills', 'security', 'SKILL.md');
    expect(c.customise({ id: 'security', path: builtin, layer: 'user' })).toBe(mine);
    expect(files.get(mine)).toBe('---\nname: security\n---\nBuilt-in.');
    files.set(mine, 'edited');
    const project = join(roots.workspace, '.claude', 'skills', 'security', 'SKILL.md');
    expect(c.customise({ id: 'security', path: builtin, layer: 'workspace' })).toBe(project);
    // An existing copy is opened as it is.
    expect(c.customise({ id: 'security', path: builtin, layer: 'user' })).toBe(mine);
    expect(files.get(mine)).toBe('edited');
    expect(open.mock.calls.map(([p]) => p)).toEqual([mine, project, mine]);
  });

  it('copies only a SKILL.md from a skills folder', () => {
    const { council: c, files, open } = council();
    const secret = resolve('/etc/passwd');
    files.set(secret, 'root');
    const notASkill = join(roots.plugin, 'skills', 'security', 'notes.md');
    files.set(notASkill, 'x');
    expect(c.customise({ id: 'security', path: secret, layer: 'user' })).toBeNull();
    expect(c.customise({ id: 'security', path: notASkill, layer: 'user' })).toBeNull();
    const missing = join(roots.plugin, 'skills', 'gone', 'SKILL.md');
    expect(c.customise({ id: 'security', path: missing, layer: 'user' })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("writes a new councillor from the template and opens it; there's no project without a folder", () => {
    const { council: c, files, open } = council();
    const target = join(roots.workspace, '.claude', 'skills', 'perf', 'SKILL.md');
    expect(
      c.create({ id: 'perf', title: 'Performance', description: 'Speed.', layer: 'workspace' }),
    ).toBe(target);
    expect(files.get(target)).toBe(
      councillorTemplate({ id: 'perf', title: 'Performance', description: 'Speed.' }),
    );
    expect(open).toHaveBeenCalledWith(target);
    const noFolder = new GuildCouncil({
      inspect: () => undefined,
      update: async () => {},
      files: { exists: () => false, read: () => '', write: () => {} },
      roots: { ...roots, workspace: undefined },
      open: () => {},
    });
    expect(
      noFolder.create({ id: 'perf', title: 'P', description: 'S', layer: 'workspace' }),
    ).toBeNull();
  });

  it('marks the template for the council and keeps it out of the hero menu', () => {
    const text = councillorTemplate({ id: 'perf', title: 'Performance', description: 'Speed.' });
    for (const line of [
      'name: perf',
      'ibitsa-councillor: true',
      'ibitsa-title: Performance',
      'ibitsa-target: council',
      'disable-model-invocation: true',
      '## Planning',
      '## Review',
    ])
      expect(text).toContain(line);
  });
});
