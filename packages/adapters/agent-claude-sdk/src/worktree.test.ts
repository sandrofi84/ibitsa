import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Worktree } from './worktree';

describe('Worktree (#56)', () => {
  it('gives paths inside relative with /, and null outside', () => {
    const wt = new Worktree({ dir: '/wt', platform: 'linux' });
    expect(wt.relative('/wt/src/a.ts')).toBe('src/a.ts');
    expect(wt.relative('/wt')).toBe('');
    expect(wt.relative('/wt-other/a.ts')).toBeNull();
    expect(wt.relative('/elsewhere')).toBeNull();
    expect(wt.contains('/wt/a')).toBe(true);
  });

  it('on Windows takes either separator and any case', () => {
    const wt = new Worktree({ dir: 'C:\\Users\\Ada\\wt', platform: 'win32' });
    expect(wt.relative('c:\\users\\ada\\WT\\src\\A.ts')).toBe('src/A.ts');
    expect(wt.relative('C:/Users/Ada/wt/src/a.ts')).toBe('src/a.ts');
    expect(wt.relative('C:\\Users\\Ada\\wt2\\a.ts')).toBeNull();
  });

  it('elsewhere, case matters', () => {
    const wt = new Worktree({ dir: '/wt', platform: 'darwin' });
    expect(wt.relative('/WT/a.ts')).toBeNull();
  });

  it('knows the worktree by its resolved path too (macOS /private/var)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ibitsa-wt-'));
    expect(new Worktree({ dir }).relative(`${realpathSync(dir)}/notes.txt`)).toBe('notes.txt');
  });
});
