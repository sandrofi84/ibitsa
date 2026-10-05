import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classify, TestDetector } from './activity';

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

describe('classify (spec §5.4)', () => {
  const cwd = '/repo.ibitsa/ibitsa/fix';
  const tests = new TestDetector('/nowhere');
  it.each([
    {
      tool: 'Read',
      input: { file_path: `${cwd}/src/auth.ts` },
      expected: { kind: 'read', detail: 'src/auth.ts' },
    },
    { tool: 'Grep', input: { pattern: 'logout' }, expected: { kind: 'search', detail: 'logout' } },
    {
      tool: 'Glob',
      input: { pattern: '**/*.ts' },
      expected: { kind: 'search', detail: '**/*.ts' },
    },
    {
      tool: 'WebFetch',
      input: { url: 'https://x.dev' },
      expected: { kind: 'search', detail: 'https://x.dev' },
    },
    {
      tool: 'Edit',
      input: { file_path: `${cwd}/src/a.ts` },
      expected: { kind: 'edit', detail: 'src/a.ts' },
    },
    {
      tool: 'Write',
      input: { file_path: '/elsewhere/b.ts' },
      expected: { kind: 'edit', detail: '/elsewhere/b.ts' },
    },
    {
      tool: 'Bash',
      input: { command: 'pnpm test auth' },
      expected: { kind: 'test', detail: 'pnpm test auth' },
    },
    {
      tool: 'Bash',
      input: { command: 'npx vitest run' },
      expected: { kind: 'test', detail: 'npx vitest run' },
    },
    {
      tool: 'Bash',
      input: { command: 'go test ./...' },
      expected: { kind: 'test', detail: 'go test ./...' },
    },
    {
      tool: 'Bash',
      input: { command: 'git status' },
      expected: { kind: 'run', detail: 'git status' },
    },
    { tool: 'TodoWrite', input: {}, expected: { kind: 'other', detail: 'TodoWrite' } },
    {
      tool: 'mcp__ibitsa__submit_task',
      input: {},
      expected: { kind: 'other', detail: 'mcp__ibitsa__submit_task' },
    },
  ])('$tool → $expected.kind', ({ tool, input, expected }) => {
    expect(classify({ tool, input, cwd, tests })).toEqual(expected);
  });

  it('shows paths relative to the worktree even when the tool reports the resolved path', () => {
    const dir = worktree();
    const resolved = realpathSync(dir);
    expect(
      classify({ tool: 'Read', input: { file_path: `${resolved}/notes.txt` }, cwd: dir, tests })
        .detail,
    ).toBe('notes.txt');
  });

  it('leaves the detail out when the input lacks the expected field', () => {
    expect(classify({ tool: 'Read', input: {}, cwd, tests })).toEqual({ kind: 'read' });
    expect(classify({ tool: 'Grep', input: null, cwd, tests })).toEqual({ kind: 'search' });
    expect(classify({ tool: 'Edit', input: { file_path: 3 }, cwd, tests })).toEqual({
      kind: 'edit',
    });
  });

  it('keeps details short and to one line', () => {
    const long = `echo ${'x'.repeat(200)}\nsecond line`;
    const { detail } = classify({ tool: 'Bash', input: { command: long }, cwd, tests });
    expect(detail?.length).toBe(120);
    expect(detail).not.toContain('second line');
  });
});

describe('TestDetector', () => {
  it("counts the worktree's own test scripts", () => {
    const tests = new TestDetector(
      worktree({ 'test:unit': 'vitest', check: 'tsc', 'test-e2e': 'playwright' }),
    );
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
