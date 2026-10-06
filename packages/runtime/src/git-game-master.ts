import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { GameMasterEvent } from '@ibitsa/core';
import type { RepoView } from '@ibitsa/protocol';
import { git, shell } from './git';
import type { GitGameMasterOptions } from './git-game-master.types';
import type { GameMaster } from './ports.types';

/** Last chunk of a failed setup command's output kept in the error. */
const OUTPUT_TAIL = 2_000;

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
    return result(true);
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
