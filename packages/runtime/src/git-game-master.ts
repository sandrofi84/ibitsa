import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { GameMasterEvent } from '@ibitsa/core';
import type { CheckResult, RepoView } from '@ibitsa/protocol';
import { git, shell } from './git';
import type { GitGameMasterOptions } from './git-game-master.types';
import type { GameMaster } from './ports.types';

/** Last chunk of a failed setup command's output kept in the error. */
const OUTPUT_TAIL = 2_000;
/** Last chunk of a check's output the hero and reviewers see (§5.5). */
const CHECK_TAIL = 4_000;
/** The most of a diff a reviewer gets; past it, the diff says it was cut. */
const DIFF_LIMIT = 60_000;
/** `package.json` scripts run as checks when `ibitsa.checks` isn't set, in this order (§5.5). */
const CHECK_SCRIPTS = ['test', 'lint', 'typecheck', 'check'];

/**
 * The game master's work in the repository (spec §5.3, §5.5, §14.1): worktrees, the setup command, the
 * submit check, the diff hash for the no-progress rule, and the repo scan for the New Quest form.
 */
export class GitGameMaster implements GameMaster {
  private readonly options: GitGameMasterOptions;

  constructor(options: GitGameMasterOptions) {
    this.options = options;
  }

  async scanRepo(): Promise<RepoView | null> {
    const repo = this.options.repoDir;
    if (!(await git(repo, ['rev-parse', '--is-inside-work-tree'])).ok) return null;
    const refs = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
    const branches = refs.output.split('\n').filter(Boolean);
    const defaultBranch = await this.defaultBranch(branches);
    const status = await git(repo, ['status', '--porcelain']);
    return {
      defaultBranch,
      branches: [defaultBranch, ...branches.filter((b) => b !== defaultBranch)],
      uncommittedChanges: status.output.split('\n').filter(Boolean).length,
    };
  }

  /** At most this many paths: a file menu, not an index. */
  static readonly FILE_LIMIT = 20_000;

  async listFiles({ worktreePath }: { worktreePath: string }): Promise<string[]> {
    const listed = await git(worktreePath, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ]);
    if (!listed.ok) return [];
    return [...new Set(listed.output.split('\n').filter(Boolean))].slice(
      0,
      GitGameMaster.FILE_LIMIT,
    );
  }

  async createWorktree({
    islandId,
    branch,
    baseRef,
  }: {
    islandId: string;
    branch: string;
    baseRef: string;
  }): Promise<GameMasterEvent> {
    const repo = this.options.repoDir;
    const failed = (message: string): GameMasterEvent => ({
      type: 'worktreeFailed',
      islandId,
      message,
    });
    if (!(await git(repo, ['rev-parse', '--is-inside-work-tree'])).ok) {
      return failed('the workspace is not a git repository');
    }
    const actual = await this.freeBranch(branch);
    const path = this.worktreePath(actual);
    const added = await git(repo, ['worktree', 'add', '-b', actual, path, baseRef]);
    if (!added.ok) return failed(added.output || `git worktree add failed for ${actual}`);

    const setup = this.options.setupCommand().trim();
    if (setup) {
      const result = await shell({
        command: setup,
        cwd: path,
        timeoutMs: this.options.setupTimeoutMs ?? 10 * 60_000,
      });
      if (!result.ok) {
        return failed(
          `the setup command \`${setup}\` failed:\n${result.output.slice(-OUTPUT_TAIL)}`,
        );
      }
    }
    return { type: 'worktreeCreated', islandId, path, branch: actual };
  }

  /** Clean worktree and at least one commit beyond the base (spec §5.5). */
  async checkSubmit({
    heroId,
    toolUseId,
    worktreePath,
    baseRef,
  }: {
    heroId: string;
    toolUseId: string;
    worktreePath: string;
    baseRef: string;
  }): Promise<GameMasterEvent> {
    const result = (ok: boolean, reason?: string): GameMasterEvent => ({
      type: 'submitChecked',
      heroId,
      toolUseId,
      ok,
      ...(reason === undefined ? {} : { reason }),
    });
    const status = await git(worktreePath, ['status', '--porcelain']);
    if (!status.ok) return result(false, `The worktree could not be checked: ${status.output}`);
    if (status.output !== '') {
      return result(false, 'Commit your changes first: the worktree has uncommitted changes.');
    }
    const ahead = await git(worktreePath, ['rev-list', '--count', `${baseRef}..HEAD`]);
    if (!ahead.ok || Number(ahead.output) < 1) {
      return result(false, `Nothing to submit: there are no commits beyond ${baseRef}.`);
    }
    // What was submitted (M5): reviewers review up to this commit, even if the hero commits more later.
    const head = await git(worktreePath, ['rev-parse', 'HEAD']);
    return head.ok
      ? { type: 'submitChecked', heroId, toolUseId, ok: true, head: head.output }
      : result(true);
  }

  /**
   * A submitted task's checks (§5.5, M5): `ibitsa.checks`, else the worktree's `package.json` scripts
   * named test, lint, typecheck or check, run with its package manager. One at a time, stopping at the
   * first failure; each keeps the end of its output.
   */
  async runChecks({ worktreePath }: { worktreePath: string }): Promise<CheckResult[]> {
    const commands = this.options.checks?.() ?? detectChecks(worktreePath);
    const results: CheckResult[] = [];
    for (const command of commands) {
      const run = await shell({
        command,
        cwd: worktreePath,
        timeoutMs: this.options.checkTimeoutMs ?? 10 * 60_000,
        env: { CI: '1' },
      });
      results.push({ command, ok: run.ok, output: run.output.slice(-CHECK_TAIL) });
      if (!run.ok) break;
    }
    return results;
  }

  /**
   * What a reviewer reads (§5.5, M5): the task's commits `from..to`, or only `since..to` on a re-review,
   * as a stat then the patch, cut at a size a reviewer can read.
   */
  async taskDiff({
    worktreePath,
    from,
    to,
    since,
  }: {
    worktreePath: string;
    from: string;
    to: string | null;
    since: string | null;
  }): Promise<string> {
    const range = `${since ?? from}..${to ?? 'HEAD'}`;
    const stat = await git(worktreePath, ['diff', '--stat', range]);
    const patch = await git(worktreePath, ['diff', range]);
    if (!stat.ok || !patch.ok)
      return `The diff ${range} could not be read: ${stat.ok ? patch.output : stat.output}`;
    const text = `${stat.output}\n\n${patch.output}`;
    return text.length > DIFF_LIMIT
      ? `${text.slice(0, DIFF_LIMIT)}\n\n(The diff was cut at ${DIFF_LIMIT} characters: read the files for the rest.)`
      : text;
  }

  /**
   * Stacked, all at once (spec §5.3, #122): catch a later island up with the branch it builds on,
   * between its hero's turns. Already containing it is `upToDate`; a clean rebase is `rebased`; a
   * conflict is aborted, leaving the worktree as it was, and reported as `conflict` for the hero to
   * resolve. Uncommitted work is never rebased or stashed: that is a `conflict` for the hero too.
   */
  /** `origin`'s URL, for the git host (§5.6); null without one. */
  async remoteUrl(): Promise<string | null> {
    const url = await git(this.options.repoDir, ['remote', 'get-url', 'origin']);
    return url.ok && url.output ? url.output : null;
  }

  /**
   * Pushes the worktree's branch to `origin` (§5.6) with the user's own git credentials, never waiting
   * on a terminal prompt. `force` is `--force-with-lease`, for a restack (#154).
   */
  async push({
    worktreePath,
    branch,
    force = false,
  }: {
    worktreePath: string;
    branch: string;
    force?: boolean;
  }): Promise<{ ok: true; head: string } | { ok: false; reason: string }> {
    const args = ['push', ...(force ? ['--force-with-lease'] : []), '-u', 'origin', branch];
    const pushed = await git(worktreePath, { args, env: { GIT_TERMINAL_PROMPT: '0' } });
    if (!pushed.ok) return { ok: false, reason: pushed.output.slice(-OUTPUT_TAIL) };
    const head = await git(worktreePath, ['rev-parse', 'HEAD']);
    return head.ok ? { ok: true, head: head.output } : { ok: false, reason: head.output };
  }

  async rebaseWorktree({
    worktreePath,
    onto,
  }: {
    worktreePath: string;
    onto: string;
  }): Promise<'upToDate' | 'rebased' | 'conflict'> {
    if ((await git(worktreePath, ['merge-base', '--is-ancestor', onto, 'HEAD'])).ok)
      return 'upToDate';
    const status = await git(worktreePath, ['status', '--porcelain']);
    if (!status.ok || status.output !== '') return 'conflict';
    if ((await git(worktreePath, ['rebase', onto])).ok) return 'rebased';
    await git(worktreePath, ['rebase', '--abort']);
    return 'conflict';
  }

  /** Changes to tracked files and the list of untracked ones; new files count as progress too. */
  async observeDiff({ worktreePath }: { worktreePath: string }): Promise<string> {
    const diff = await git(worktreePath, ['diff', 'HEAD']);
    const status = await git(worktreePath, ['status', '--porcelain', '--untracked-files=all']);
    if (!diff.ok || !status.ok) throw new Error(diff.ok ? status.output : diff.output);
    return createHash('sha256')
      .update(diff.output)
      .update('\0')
      .update(status.output)
      .digest('hex');
  }

  async removeWorktree({
    worktreePath,
  }: {
    worktreePath: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const status = await git(worktreePath, ['status', '--porcelain']);
    if (status.ok && status.output !== '') {
      return { ok: false, reason: 'The worktree has uncommitted changes.' };
    }
    // Without --force, git also refuses a dirty worktree; the branch is kept either way.
    const removed = await git(this.options.repoDir, ['worktree', 'remove', worktreePath]);
    return removed.ok ? { ok: true } : { ok: false, reason: removed.output };
  }

  /** `../<repo>.ibitsa/<branch>` next to the repository (spec §5.3). */
  private worktreePath(branch: string): string {
    const repo = this.options.repoDir;
    return join(dirname(repo), `${basename(repo)}.ibitsa`, branch);
  }

  /** The branch name, or the first `-2`, `-3`… variant whose branch and worktree folder are both free. */
  private async freeBranch(branch: string): Promise<string> {
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? branch : `${branch}-${n}`;
      const taken = (
        await git(this.options.repoDir, [
          'show-ref',
          '--verify',
          '--quiet',
          `refs/heads/${candidate}`,
        ])
      ).ok;
      if (!taken && !existsSync(this.worktreePath(candidate))) return candidate;
    }
  }

  /** `origin/HEAD`, else `main` or `master`, else the current branch. */
  private async defaultBranch(branches: string[]): Promise<string> {
    const origin = await git(this.options.repoDir, [
      'symbolic-ref',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    if (origin.ok) return origin.output.replace(/^origin\//, '');
    for (const name of ['main', 'master']) if (branches.includes(name)) return name;
    const current = await git(this.options.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return current.ok ? current.output : 'main';
  }
}

/** The checks a worktree's `package.json` offers, run with the package manager its lockfile names. */
export function detectChecks(worktreePath: string): string[] {
  let scripts: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(readFileSync(join(worktreePath, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };
    scripts = pkg.scripts ?? {};
  } catch {
    return [];
  }
  const runner = existsSync(join(worktreePath, 'pnpm-lock.yaml'))
    ? 'pnpm run'
    : existsSync(join(worktreePath, 'yarn.lock'))
      ? 'yarn run'
      : 'npm run';
  return CHECK_SCRIPTS.filter((name) => typeof scripts[name] === 'string').map(
    (name) => `${runner} ${name}`,
  );
}
