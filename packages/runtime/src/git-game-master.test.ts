import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectChecks, GitGameMaster } from './git-game-master';

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

describe('listFiles (#83)', () => {
  it('lists tracked and untracked files, never ignored ones', async () => {
    const dir = repo();
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'app.ts'), 'x');
    writeFileSync(join(dir, '.gitignore'), 'dist/\n*.log\n');
    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'dist', 'out.js'), 'x');
    writeFileSync(join(dir, 'debug.log'), 'x');
    expect((await gm(dir).listFiles({ worktreePath: dir })).sort()).toEqual([
      '.gitignore',
      'README.md',
      'src/app.ts',
    ]);
  });

  it('returns nothing outside a repository', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ibitsa-nogit-'));
    roots.push(root);
    expect(await gm(root).listFiles({ worktreePath: root })).toEqual([]);
  });
});

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
    // Runs under sh, or cmd.exe on Windows: this command means the same in both.
    const event = await gm(dir, 'echo no lockfile 1>&2 && exit 3').createWorktree({
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
      // What was submitted (M5): reviewers review up to it.
      head: run(wt, 'rev-parse', 'HEAD'),
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

describe('rebaseWorktree (#122)', () => {
  /** A stacked pair: `ibitsa/a` from main, and `ibitsa/b` from `ibitsa/a`, each in its worktree. */
  async function stacked() {
    const dir = repo();
    // Rebasing rewrites commits, so the repo needs an identity (worktrees share its config).
    run(dir, 'config', 'user.name', 'Test');
    run(dir, 'config', 'user.email', 'test@example.com');
    const master = gm(dir);
    const a = await master.createWorktree({ islandId: 'i1', branch: 'ibitsa/a', baseRef: 'main' });
    const b = await master.createWorktree({
      islandId: 'i2',
      branch: 'ibitsa/b',
      baseRef: 'ibitsa/a',
    });
    if (a.type !== 'worktreeCreated' || b.type !== 'worktreeCreated')
      throw new Error('no worktrees');
    const commit = ({ wt, file, text }: { wt: string; file: string; text: string }) => {
      writeFileSync(join(wt, file), text);
      run(wt, 'add', '.');
      run(wt, 'commit', '-q', '-m', `edit ${file}`);
    };
    return { master, a: a.path, b: b.path, commit };
  }

  it("starts a stacked island from the earlier island's branch, with its commits", async () => {
    const dir = repo();
    const master = gm(dir);
    const a = await master.createWorktree({ islandId: 'i1', branch: 'ibitsa/a', baseRef: 'main' });
    if (a.type !== 'worktreeCreated') throw new Error('no worktree');
    writeFileSync(join(a.path, 'a.txt'), 'a\n');
    run(a.path, 'add', '.');
    run(a.path, 'commit', '-q', '-m', 'island a');
    const b = await master.createWorktree({
      islandId: 'i2',
      branch: 'ibitsa/b',
      baseRef: 'ibitsa/a',
    });
    if (b.type !== 'worktreeCreated') throw new Error('no worktree');
    expect(run(b.path, 'log', '--format=%s')).toBe('island a\ninit');
  });

  it('is up to date while the later branch already contains the earlier one', async () => {
    const { master, b, commit } = await stacked();
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('upToDate');
    commit({ wt: b, file: 'b.txt', text: 'b\n' });
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('upToDate');
  });

  it('rebases cleanly onto new commits on the earlier branch', async () => {
    const { master, a, b, commit } = await stacked();
    commit({ wt: b, file: 'b.txt', text: 'b\n' });
    commit({ wt: a, file: 'a.txt', text: 'a\n' });
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('rebased');
    expect(run(b, 'log', '--format=%s')).toBe('edit b.txt\nedit a.txt\ninit');
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('upToDate');
  });

  it('aborts a conflicting rebase, leaving the worktree as it was', async () => {
    const { master, a, b, commit } = await stacked();
    commit({ wt: b, file: 'README.md', text: '# from b\n' });
    commit({ wt: a, file: 'README.md', text: '# from a\n' });
    const before = run(b, 'rev-parse', 'HEAD');
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('conflict');
    expect(run(b, 'rev-parse', 'HEAD')).toBe(before);
    expect(run(b, 'status', '--porcelain')).toBe('');
    expect(run(b, 'cat-file', '-p', 'HEAD:README.md')).toBe('# from b');
  });

  it('leaves uncommitted work alone: the hero rebases that itself', async () => {
    const { master, a, b, commit } = await stacked();
    commit({ wt: a, file: 'a.txt', text: 'a\n' });
    writeFileSync(join(b, 'wip.txt'), 'work in progress\n');
    expect(await master.rebaseWorktree({ worktreePath: b, onto: 'ibitsa/a' })).toBe('conflict');
    expect(existsSync(join(b, 'wip.txt'))).toBe(true);
    expect(existsSync(join(b, 'a.txt'))).toBe(false);
  });
});

describe('runChecks (#137)', () => {
  async function worktreeWith(files: Record<string, string>) {
    const dir = repo();
    const created = await gm(dir).createWorktree({
      islandId: 'i1',
      branch: 'ibitsa/x',
      baseRef: 'main',
    });
    if (created.type !== 'worktreeCreated') throw new Error('no worktree');
    for (const [name, text] of Object.entries(files)) writeFileSync(join(created.path, name), text);
    return { dir, wt: created.path };
  }
  const pkg = (scripts: Record<string, string>) => JSON.stringify({ name: 'x', scripts });

  it('runs the listed commands in order, stopping at the first failure, with the end of its output', async () => {
    const { dir, wt } = await worktreeWith({});
    const master = new GitGameMaster({
      repoDir: dir,
      setupCommand: () => '',
      checks: () => [
        'echo first',
        'node -e "console.log(\'x\'.repeat(5000)); process.exit(1)"',
        'echo never',
      ],
    });
    const results = await master.runChecks({ worktreePath: wt });
    expect(results.map((r) => [r.command.split(' ')[0], r.ok])).toEqual([
      ['echo', true],
      ['node', false],
    ]);
    expect(results[0]?.output).toBe('first');
    expect(results[1]?.output).toHaveLength(4000);
  });

  it('runs with CI set, so test runners run once', async () => {
    const { dir, wt } = await worktreeWith({});
    const master = new GitGameMaster({
      repoDir: dir,
      setupCommand: () => '',
      checks: () => ['node -e "console.log(process.env.CI)"'],
    });
    expect((await master.runChecks({ worktreePath: wt }))[0]?.output).toBe('1');
  });

  it("detects test, lint, typecheck and check scripts, run with the worktree's package manager", async () => {
    const { wt } = await worktreeWith({
      'package.json': pkg({ build: 'x', check: 'node -e 0', test: 'node -e 0', lint: 'node -e 0' }),
      'pnpm-lock.yaml': '',
    });
    expect(detectChecks(wt)).toEqual(['pnpm run test', 'pnpm run lint', 'pnpm run check']);
  });

  it('runs detected scripts and reports how each went', async () => {
    const { dir, wt } = await worktreeWith({
      'package.json': pkg({ test: 'node -e "console.log(42)"', lint: 'node -e "process.exit(2)"' }),
    });
    const results = await gm(dir).runChecks({ worktreePath: wt });
    expect(results.map((r) => [r.command, r.ok])).toEqual([
      ['npm run test', true],
      ['npm run lint', false],
    ]);
    expect(results[0]?.output).toContain('42');
  });

  it('uses yarn or npm without a pnpm lockfile, and runs nothing without a package.json or with an empty list', async () => {
    const yarn = await worktreeWith({
      'package.json': pkg({ test: 'node -e 0' }),
      'yarn.lock': '',
    });
    const npm = await worktreeWith({ 'package.json': pkg({ typecheck: 'node -e 0' }) });
    const none = await worktreeWith({});
    const broken = await worktreeWith({ 'package.json': '{ not json' });
    expect(detectChecks(yarn.wt)).toEqual(['yarn run test']);
    expect(detectChecks(npm.wt)).toEqual(['npm run typecheck']);
    expect(detectChecks(none.wt)).toEqual([]);
    expect(detectChecks(broken.wt)).toEqual([]);
    const off = new GitGameMaster({ repoDir: npm.dir, setupCommand: () => '', checks: () => [] });
    expect(await off.runChecks({ worktreePath: npm.wt })).toEqual([]);
  });
});

describe('taskDiff (#137)', () => {
  async function heroWorktree() {
    const dir = repo();
    await gm(dir).createWorktree({ islandId: 'i2', branch: 'b', baseRef: 'main' });
    return { dir, wt: worktree(dir, 'b') };
  }

  it("gives a task's commits, or only what changed since a review, as a stat and the patch", async () => {
    const { dir, wt } = await heroWorktree();
    const commit = ({ file, text }: { file: string; text: string }) => {
      writeFileSync(join(wt, file), text);
      run(wt, 'add', '.');
      run(wt, 'commit', '-q', '-m', file);
      return run(wt, 'rev-parse', 'HEAD');
    };
    const first = commit({ file: 'a.ts', text: 'export const a = 1;\n' });
    const second = commit({ file: 'b.ts', text: 'export const b = 2;\n' });
    const master = gm(dir);
    const whole = await master.taskDiff({
      worktreePath: wt,
      from: 'main',
      to: second,
      since: null,
    });
    expect(whole).toContain('a.ts');
    expect(whole).toContain('+export const b = 2;');
    const delta = await master.taskDiff({ worktreePath: wt, from: 'main', to: null, since: first });
    expect(delta).not.toContain('a.ts');
    expect(delta).toContain('b.ts | 1 +');
  });

  it('cuts a huge diff and says so, and reports a range it cannot read', async () => {
    const { dir, wt } = await heroWorktree();
    writeFileSync(join(wt, 'big.txt'), `${'line\n'.repeat(20_000)}`);
    run(wt, 'add', '.');
    run(wt, 'commit', '-q', '-m', 'big');
    const master = gm(dir);
    const big = await master.taskDiff({ worktreePath: wt, from: 'main', to: null, since: null });
    expect(big.length).toBeLessThan(61_000);
    expect(big).toContain('(The diff was cut at 60000 characters: read the files for the rest.)');
    expect(
      await master.taskDiff({ worktreePath: wt, from: 'nope', to: null, since: null }),
    ).toContain('The diff nope..HEAD could not be read');
  });
});
