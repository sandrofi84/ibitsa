import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionDraft } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeAdapter } from './claude-adapter';
import { SkillFiles } from './skill-files';
import { SkillWriter, skillText } from './skill-writer';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'ibitsa-writer-'));
  dirs.push(d);
  return d;
};
const draft = (over: Partial<ActionDraft> = {}): ActionDraft => ({
  name: 'pr-summary',
  description: 'Summarize the pull request',
  argumentHint: '[focus]',
  prompt: 'Summarize this branch for a reviewer.\nFocus on: $ARGUMENTS\n',
  target: 'hero',
  scope: 'personal',
  ...over,
});

describe('SkillWriter (#86)', () => {
  it('writes a personal skill with quoted fields that reads back the same', () => {
    const personal = temp();
    const project = temp();
    const result = new SkillWriter({ personal, project }).write({
      draft: draft(),
      overwrite: false,
    });
    expect(result).toEqual({
      ok: true,
      path: join(personal, '.claude', 'skills', 'pr-summary', 'SKILL.md'),
    });
    const read = new SkillFiles({ cwd: project, home: personal, pluginDirs: [] }).find(
      'pr-summary',
    );
    expect(read?.fields).toMatchObject({
      name: 'pr-summary',
      description: 'Summarize the pull request',
      'argument-hint': '[focus]',
      'disable-model-invocation': 'true',
      'ibitsa-target': 'hero',
    });
    expect(read?.body).toBe('Summarize this branch for a reviewer.\nFocus on: $ARGUMENTS\n');
  });

  it('writes a project skill in the repo, and leaves out an empty argument hint', () => {
    const project = temp();
    const result = new SkillWriter({ personal: temp(), project }).write({
      draft: draft({ scope: 'project', argumentHint: '', target: 'any' }),
      overwrite: false,
    });
    expect(result.ok).toBe(true);
    const text = readFileSync(join(project, '.claude', 'skills', 'pr-summary', 'SKILL.md'), 'utf8');
    expect(text).not.toContain('argument-hint');
    expect(text).toContain('ibitsa-target: any');
  });

  it('refuses a name taken in either scope unless overwriting', () => {
    const personal = temp();
    const project = temp();
    mkdirSync(join(project, '.claude', 'skills', 'pr-summary'), { recursive: true });
    writeFileSync(join(project, '.claude', 'skills', 'pr-summary', 'SKILL.md'), 'old\n');
    const writer = new SkillWriter({ personal, project });
    expect(writer.write({ draft: draft(), overwrite: false })).toEqual({
      ok: false,
      reason: 'There is already a skill named pr-summary.',
      clash: true,
    });
    expect(writer.write({ draft: draft({ scope: 'project' }), overwrite: true }).ok).toBe(true);
    expect(
      readFileSync(join(project, '.claude', 'skills', 'pr-summary', 'SKILL.md'), 'utf8'),
    ).toContain('Summarize this branch');
  });

  it("reports a folder it can't write to", () => {
    const blocked = temp();
    writeFileSync(join(blocked, '.claude'), 'a file, not a folder');
    const result = new SkillWriter({ personal: blocked, project: temp() }).write({
      draft: draft(),
      overwrite: false,
    });
    expect(result).toMatchObject({ ok: false, clash: false });
  });

  it('keeps the description on one line, quoted', () => {
    expect(skillText(draft({ description: 'two\nlines: "x"' }))).toContain(
      'description: "two lines: \\"x\\""',
    );
  });

  it('is how the Claude adapter creates actions', async () => {
    const personal = temp();
    const result = await new ClaudeAdapter({ env: () => ({}) }).createAction({
      draft: draft(),
      overwrite: false,
      roots: { personal, project: temp() },
    });
    expect(result).toMatchObject({ ok: true });
  });
});
