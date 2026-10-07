export interface PackLibraryDeps {
  /** The user's home: packs in `~/.ibitsa/packs/`. */
  home: string;
  /** The workspace: packs in `.ibitsa/packs/`. */
  workspace: string | undefined;
  /** A pack file's address for the webview, from its path on disk. */
  url(path: string): string;
}
