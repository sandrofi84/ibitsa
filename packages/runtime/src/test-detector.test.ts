import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TestDetector } from './test-detector';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function worktree(scripts?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ibitsa-wt-'));
  dirs.push(dir);
  if (scripts) writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts }));
  return dir;
}

describe('TestDetector (spec §5.4)', () => {
  it.each(['pnpm test auth', 'npm run test', 'npx vitest run', 'go test ./...', 'cargo test'])(
    '%s is a test',
    (command) => {
      expect(new TestDetector(worktree()).isTest(command)).toBe(true);
    },
  );

  it('git status is not', () => {
    expect(new TestDetector(worktree()).isTest('git status')).toBe(false);
  });

  it("counts the worktree's own test scripts", () => {
    const tests = new TestDetector(
      worktree({ 'test:unit': 'vitest', check: 'tsc', 'test-e2e': 'playwright' }),
    );
    expect(tests.scriptNames).toEqual(['test:unit', 'test-e2e']);
    expect(tests.isTest('pnpm run test-e2e')).toBe(true);
    expect(tests.isTest('pnpm test:unit')).toBe(true);
    expect(tests.isTest('pnpm check')).toBe(false);
  });

  it('works without a package.json or with a broken one', () => {
    const broken = worktree();
    writeFileSync(join(broken, 'package.json'), '{ nope');
    expect(new TestDetector(broken).isTest('pytest -q')).toBe(true);
    expect(new TestDetector(worktree()).isTest('make')).toBe(false);
  });
});
