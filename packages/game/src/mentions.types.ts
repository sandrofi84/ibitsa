/** A command bar message after its recipient @mention is taken out (#83). */
export interface ParsedMessage {
  /** The handle of the first @mention that names a recipient (e.g. `ranger-ilse`, `all`), if any. */
  recipient: string | null;
  /** The message without that mention; file @mentions stay, so the hero sees the paths. */
  text: string;
}
