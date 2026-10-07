export interface GitGameMasterOptions {
  /** The workspace repository. */
  repoDir: string;
  /** The `ibitsa.worktree.setup` command, read when a worktree is created; empty runs nothing. */
  setupCommand: () => string;
  /** Default 10 minutes. */
  setupTimeoutMs?: number;
  /**
   * `ibitsa.checks` (§5.5, M5): the commands to run on a submitted task. Null (unset) detects them from
   * the worktree's `package.json`; an empty list runs none.
   */
  checks?: () => string[] | null;
  /** Each check's timeout; default 10 minutes. */
  checkTimeoutMs?: number;
}
