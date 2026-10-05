import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitGameMaster } from './git-game-master';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const run = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    cwd,
    stdio: 'pipe',
  })
    .toString()
    .trim();

/** A repo with one commit on `main`, inside its own temp folder (worktrees go next to it). */
function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ibitsa-git-')));
  roots.push(root);
  const dir = join(root, 'demo');
  mkdirSync(dir);
  run(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), '# demo\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

const gm = (repoDir: string, setupCommand = '') =>
  new GitGameMaster({ repoDir, setupCommand: () => setupCommand });
const worktree = (dir: string, branch: string) => join(dir, '..', 'demo.ibitsa', branch);

describe('scanRepo', () => {
  it('reports the default branch first, the other branches and uncommitted changes', async () => {
    const dir = repo();
    run(dir, 'branch', 'feature');
    writeFileSync(join(dir, 'README.md'), '# changed\n');
    writeFileSync(join(dir, 'new.txt'), 'x');
    expect(await gm(dir).scanRepo()).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'feature'],
      uncommittedChanges: 2,
    });
  });

  it("prefers origin's default branch", async () => {
    const dir = repo();
    run(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk');
    expect((await gm(dir).scanRepo())?.defaultBranch).toBe('trunk');
  });

  it('returns null outside a git repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ibitsa-nogit-'));
    roots.push(root);
    expect(await gm(root).scanRepo()).toBeNull();
  });
});

describe('createWorktree', () => {
  it('adds a worktree next to the repo on a new branch from the base', async () => {
    const dir = repo();
    const event = await gm(dir).createWorktree({
      islandId: 'i2',
      branch: 'ibitsa/fix-login',
      baseRef: 'main',
    });
    expect(event).toEqual({
      type: 'worktreeCreated',
      islandId: 'i2',
      path: worktree(dir, 'ibitsa/fix-login'),
      branch: 'ibitsa/fix-login',
    });
    expect(existsSync(join(worktree(dir, 'ibitsa/fix-login'), 'README.md'))).toBe(true);
    expect(run(worktree(dir, 'ibitsa/fix-login'), 'branch', '--show-current')).toBe(
      'ibitsa/fix-login',
    );
  });

  it('picks the next free name when the branch is taken', async () => {
    const dir = repo();
    run(dir, 'branch', 'ibitsa/fix-login');
    const event = await gm(dir).createWorktree({
      islandId: 'i2',
      branch: 'ibitsa/fix-login',
      baseRef: 'main',
    });
    expect(event).toMatchObject({ type: 'worktreeCreated', branch: 'ibitsa/fix-login-2' });
  });

  it('runs the setup command in the new worktree', async () => {
    const dir = repo();
    await gm(dir, 'echo ready > setup-ran.txt').createWorktree({
      islandId: 'i2',
      branch: 'b',
      baseRef: 'main',
    });
    expect(existsSync(join(worktree(dir, 'b'), 'setup-ran.txt'))).toBe(true);
  });

  it('fails with the output when the setup command fails', async () => {
    const dir = repo();
    const event = await gm(dir, 'echo installing; echo no lockfile >&2; exit 3').createWorktree({
      islandId: 'i2',
      branch: 'b',
      baseRef: 'main',
    });
    expect(event.type).toBe('worktreeFailed');
    expect(event.type === 'worktreeFailed' && event.message).toContain('no lockfile');
  });

  it('fails outside a git repository, or from a base that does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ibitsa-nogit-'));
    roots.push(root);
    expect(await gm(root).createWorktree({ islandId: 'i2', branch: 'b', baseRef: 'main' })).toEqual(
      {
        type: 'worktreeFailed',
        islandId: 'i2',
        message: 'the workspace is not a git repository',
      },
    );
    const event = await gm(repo()).createWorktree({ islandId: 'i2', branch: 'b', baseRef: 'nope' });
    expect(event.type).toBe('worktreeFailed');
  });
});

describe('checkSubmit', () => {
  async function heroWorktree() {
    const dir = repo();
    await gm(dir).createWorktree({ islandId: 'i2', branch: 'b', baseRef: 'main' });
    return { dir, wt: worktree(dir, 'b') };
  }
  const check = (dir: string, wt: string) =>
    gm(dir).checkSubmit({ heroId: 'h4', toolUseId: 'u9', worktreePath: wt, baseRef: 'main' });

  it('rejects uncommitted changes', async () => {
    const { dir, wt } = await heroWorktree();
    writeFileSync(join(wt, 'fix.ts'), 'x');
    expect(await check(dir, wt)).toEqual({
      type: 'submitChecked',
      heroId: 'h4',
      toolUseId: 'u9',
      ok: false,
      reason: 'Commit your changes first: the worktree has uncommitted changes.',
    });
  });

  it('rejects a branch with no commits beyond the base', async () => {
    const { dir, wt } = await heroWorktree();
    expect(await check(dir, wt)).toMatchObject({
      ok: false,
      reason: 'Nothing to submit: there are no commits beyond main.',
    });
  });

  it('accepts a clean worktree with a commit', async () => {
    const { dir, wt } = await heroWorktree();
    writeFileSync(join(wt, 'fix.ts'), 'x');
    run(wt, 'add', '.');
    run(wt, 'commit', '-q', '-m', 'fix');
    expect(await check(dir, wt)).toEqual({
      type: 'submitChecked',
      heroId: 'h4',
      toolUseId: 'u9',
      ok: true,
    });
  });
});

describe('observeDiff', () => {
  it('changes when tracked files change or new files appear, and not otherwise', async () => {
    const dir = repo();
    const g = gm(dir);
    const a = await g.observeDiff({ worktreePath: dir });
    expect(await g.observeDiff({ worktreePath: dir })).toBe(a);
    writeFileSync(join(dir, 'README.md'), '# edited\n');
    const b = await g.observeDiff({ worktreePath: dir });
    expect(b).not.toBe(a);
    writeFileSync(join(dir, 'brand-new.ts'), 'x');
    expect(await g.observeDiff({ worktreePath: dir })).not.toBe(b);
  });
});

describe('removeWorktree', () => {
  it('refuses a dirty worktree and removes a clean one, keeping the branch', async () => {
    const dir = repo();
    const g = gm(dir);
    await g.createWorktree({ islandId: 'i2', branch: 'b', baseRef: 'main' });
    const wt = worktree(dir, 'b');
    writeFileSync(join(wt, 'wip.ts'), 'x');
    expect(await g.removeWorktree({ worktreePath: wt })).toEqual({
      ok: false,
      reason: 'The worktree has uncommitted changes.',
    });
    rmSync(join(wt, 'wip.ts'));
    expect(await g.removeWorktree({ worktreePath: wt })).toEqual({ ok: true });
    expect(existsSync(wt)).toBe(false);
    expect(run(dir, 'branch', '--list', 'b')).toContain('b');
  });
});
