export interface GitGameMasterOptions {
  /** The workspace repository. */
  repoDir: string;
  /** The `ibitsa.worktree.setup` command, read when a worktree is created; empty runs nothing. */
  setupCommand: () => string;
  /** Default 10 minutes. */
  setupTimeoutMs?: number;
}
