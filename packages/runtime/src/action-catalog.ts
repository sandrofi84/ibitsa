import { existsSync, watch as watchFs } from 'node:fs';
import { join } from 'node:path';
import type { ActionInfo } from '@ibitsa/protocol';
import type { ActionCatalogOptions, FolderWatcher } from './action-catalog.types';

/**
 * The `/` menu's actions per folder (#84), listed by the adapter once and kept until a skill changes:
 * the project's and the user's `.claude` folders are watched, and a change drops the cached list.
 */
export class ActionCatalog {
  private readonly cache = new Map<string, Promise<ActionInfo[]>>();
  private readonly watchers = new Map<string, { close(): void }[]>();

  constructor(private readonly options: ActionCatalogOptions) {}

  list(cwd: string): Promise<ActionInfo[]> {
    const cached = this.cache.get(cwd);
    if (cached) return cached;
    const listing = this.options.list({ cwd });
    this.cache.set(cwd, listing);
    // A failed listing isn't kept: the next request tries again.
    listing.catch(() => this.cache.delete(cwd));
    if (!this.watchers.has(cwd)) this.watchFolders(cwd);
    return listing;
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
