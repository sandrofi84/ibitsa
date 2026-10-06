import { existsSync, watch as watchFs } from 'node:fs';
import { join } from 'node:path';
import type { FolderWatcher, SkillCatalogOptions } from './skill-catalog.types';

/**
 * Something read from skills per folder, listed by the adapter once and kept until a skill changes: the
 * `/` menu's actions (#84) and the councillors (#98). The project's and the user's `.claude` folders are
 * watched, and a change drops the cached list.
 */
export class SkillCatalog<T> {
  private readonly cache = new Map<string, Promise<T[]>>();
  private readonly watchers = new Map<string, { close(): void }[]>();

  constructor(private readonly options: SkillCatalogOptions<T>) {}

  list(cwd: string): Promise<T[]> {
    const cached = this.cache.get(cwd);
    if (cached) return cached;
    const listing = this.options.list({ cwd });
    this.cache.set(cwd, listing);
    // A failed listing isn't kept: the next request tries again.
    listing.catch(() => this.cache.delete(cwd));
    if (!this.watchers.has(cwd)) this.watchFolders(cwd);
    return listing;
  }

  /** Drops every cached list and tells each watched folder's listeners, e.g. after a new skill (#86). */
  refresh(): void {
    this.cache.clear();
    for (const cwd of this.watchers.keys()) this.options.onChange(cwd);
  }

  dispose(): void {
    for (const list of this.watchers.values()) for (const w of list) w.close();
    this.watchers.clear();
    this.cache.clear();
  }

  private watchFolders(cwd: string): void {
    const onChange = () => {
      this.cache.delete(cwd);
      this.options.onChange(cwd);
    };
    const dirs = [join(cwd, '.claude'), join(this.options.home, '.claude')].filter((d) =>
      existsSync(d),
    );
    this.watchers.set(
      cwd,
      dirs.map((dir) => this.options.watch({ dir, onChange })),
    );
  }
}

/** Node's recursive folder watching, quietly doing nothing where it can't. */
export const watchFolder: FolderWatcher = ({ dir, onChange }) => {
  try {
    const watcher = watchFs(dir, { recursive: true }, () => onChange());
    watcher.on('error', () => watcher.close());
    return watcher;
  } catch {
    return { close: () => {} };
  }
};
