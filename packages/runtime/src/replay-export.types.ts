export interface ReplayExportOptions {
  /** The workspace repo; paths inside it become relative to the worktree. */
  repoDir: string;
  /** Paths under it that are neither the worktree nor the repo become `~/…`. */
  homeDir: string;
  /** Replace what the user and the hero said with a placeholder; the quest keeps its title line. */
  blankMessages: boolean;
  /** Defaults to the real one; on Windows paths match regardless of case (#56). */
  platform?: NodeJS.Platform;
}
