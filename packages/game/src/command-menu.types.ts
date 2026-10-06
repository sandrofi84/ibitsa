/** One suggestion in a command bar menu (#83). */
export interface MenuItem {
  /** Unique within one list. */
  id: string;
  /** What the option shows, e.g. `@ranger-ilse` or `src/app.ts`. */
  label: string;
  /** A second, quieter line, e.g. the hero's state or an action's description. */
  detail?: string;
  /** Options are shown under a heading per group, in the order they first appear. */
  group?: string;
  /** What replaces the token being typed when chosen; a space follows. */
  insert: string;
  /** Instead of inserting: clears the token and does this, e.g. opens the New action form (#86). */
  onChoose?: () => void;
}

/** What a menu provider gets: the token being typed and where it sits. */
export interface MenuQuery {
  /** The whole input. */
  text: string;
  /** The token being typed, trigger included, e.g. `@src/a`. */
  token: string;
  /** The token without its trigger, e.g. `src/a`. */
  query: string;
  /** Everything before the token. */
  before: string;
}

/**
 * A command bar menu (#83): opens while a token starting with `trigger` is typed (at the start of the
 * input or after whitespace) and lists what `suggest` returns for it. An empty list closes the menu.
 */
export interface MenuProvider {
  trigger: '@' | '/';
  suggest(query: MenuQuery): MenuItem[] | Promise<MenuItem[]>;
}

/** The token being typed, if it starts with a trigger. */
export interface MenuToken {
  trigger: string;
  /** Where the token starts in the input. */
  start: number;
  token: string;
  query: string;
}
