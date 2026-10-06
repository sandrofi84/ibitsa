/** Watches a folder (recursively); returns how to stop. */
export type FolderWatcher = (request: { dir: string; onChange: () => void }) => { close(): void };

export interface SkillCatalogOptions<T> {
  list: (request: { cwd: string }) => Promise<T[]>;
  /** The user's home, whose `.claude` holds personal skills. */
  home: string;
  watch: FolderWatcher;
  /** Called when a watched folder changes, after the cached list is dropped. */
  onChange: (cwd: string) => void;
}
