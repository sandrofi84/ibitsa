import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SkillFiles, skillFolders } from './skill-files';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-skills-'));
  dirs.push(dir);
  return dir;
}
function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

describe('SkillFiles (#84)', () => {
  it('finds project, user, legacy command and plugin files and reads their frontmatter', () => {
    const cwd = temp();
    const home = temp();
    const plugin = temp();
    write(
      join(cwd, '.claude', 'skills', 'pr', 'SKILL.md'),
      '---\nname: pr\nargument-hint: "[reviewers]"\nibitsa-target: hero\n---\nOpen a PR. $ARGUMENTS\n',
    );
    write(join(home, '.claude', 'skills', 'mine', 'SKILL.md'), 'No frontmatter here.\n');
    write(
      join(cwd, '.claude', 'commands', 'old.md'),
      '---\r\ndescription: Old style\r\n---\r\nDo it.\r\n',
    );
    write(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ibitsa' }));
    write(join(plugin, 'skills', 'test', 'SKILL.md'), '---\nname: test\n---\nRun the tests.\n');
    const files = new SkillFiles({ cwd, home, pluginDirs: [plugin] });

    expect(files.find('pr')).toMatchObject({
      fields: { name: 'pr', 'argument-hint': '[reviewers]', 'ibitsa-target': 'hero' },
      body: 'Open a PR. $ARGUMENTS\n',
    });
    expect(files.find('mine')).toMatchObject({ fields: {}, body: 'No frontmatter here.\n' });
    expect(files.find('old')).toMatchObject({
      fields: { description: 'Old style' },
      body: 'Do it.\n',
    });
    expect(files.find('ibitsa:test')?.body).toBe('Run the tests.\n');
    expect(files.find('other:test')).toBeNull();
    expect(files.find('nothing')).toBeNull();
  });

  it('names a plugin by its folder when its manifest is missing', () => {
    const plugin = join(temp(), 'tools');
    write(join(plugin, 'commands', 'go.md'), 'Go.\n');
    expect(
      new SkillFiles({ cwd: temp(), home: temp(), pluginDirs: [plugin] }).find('tools:go')?.body,
    ).toBe('Go.\n');
  });

  it('lists only the skill folders that exist', () => {
    const cwd = temp();
    const home = temp();
    mkdirSync(join(cwd, '.claude', 'skills'), { recursive: true });
    expect(skillFolders({ cwd, home })).toEqual([join(cwd, '.claude', 'skills')]);
  });
});
