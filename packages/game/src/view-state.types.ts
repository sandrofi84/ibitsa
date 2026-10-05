/** Where view-only state is kept: the webview's getState/setState, or memory in the standalone build. */
export interface ViewStorage {
  load(): unknown;
  save(state: Record<string, unknown>): void;
}
