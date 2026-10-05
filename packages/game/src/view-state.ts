import type { ViewStorage } from './view-state.types';

/**
 * View-only state (spec §7.4): open panes, later the camera. It survives the tab being hidden or VS Code
 * reloading, and never reaches core.
 */
export class ViewState {
  private state: Record<string, unknown>;

  constructor(private readonly storage: ViewStorage) {
    const loaded = storage.load();
    this.state =
      loaded && typeof loaded === 'object' && !Array.isArray(loaded)
        ? { ...(loaded as Record<string, unknown>) }
        : {};
  }

  /** The stored value if it has the fallback's type, else the fallback. */
  get<T extends string | number | boolean>(key: string, fallback: T): T {
    const value = this.state[key];
    return typeof value === typeof fallback ? (value as T) : fallback;
  }

  set(key: string, value: string | number | boolean): void {
    this.state = { ...this.state, [key]: value };
    this.storage.save(this.state);
  }
}

/** For the standalone build and tests: kept for the page's lifetime only. */
export class MemoryViewStorage implements ViewStorage {
  private state: unknown;

  load(): unknown {
    return this.state;
  }

  save(state: Record<string, unknown>): void {
    this.state = state;
  }
}
