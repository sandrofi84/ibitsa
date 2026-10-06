import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectRules } from './project-rules';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const storage = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-rules-'));
  dirs.push(dir);
  return dir;
};

describe('ProjectRules', () => {
  it('adds rules once, removes them, and keeps them on disk', () => {
    const dir = storage();
    const rules = new ProjectRules(dir);
    expect(rules.list()).toEqual([]);
    expect(rules.add(['Bash(npm test:*)', 'Bash(npm run lint:*)'])).toBe(true);
    expect(rules.add(['Bash(npm test:*)'])).toBe(false);
    expect(new ProjectRules(dir).list()).toEqual(['Bash(npm test:*)', 'Bash(npm run lint:*)']);
    expect(rules.remove('Bash(npm test:*)')).toBe(true);
    expect(rules.remove('Bash(npm test:*)')).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, 'project-rules.json'), 'utf8'))).toEqual({
      allow: ['Bash(npm run lint:*)'],
    });
  });

  it('treats a broken or odd file as no rules', () => {
    const dir = storage();
    writeFileSync(join(dir, 'project-rules.json'), '{ not json');
    expect(new ProjectRules(dir).list()).toEqual([]);
    writeFileSync(join(dir, 'project-rules.json'), JSON.stringify({ allow: ['ok', 3, ''] }));
    expect(new ProjectRules(dir).list()).toEqual(['ok']);
    writeFileSync(join(dir, 'project-rules.json'), JSON.stringify({ allow: 'Bash' }));
    expect(new ProjectRules(dir).list()).toEqual([]);
  });
});
