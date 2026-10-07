import type { HostEvent } from '@ibitsa/protocol';
import type { Credentials } from './credentials.types';
import type { GuildSettings } from './guild-settings';
import type { KeyValidator } from './key-validator.types';

/** What the host channel needs from VS Code, so it can be tested without it. */
export interface HostChannelDeps {
  credentials(): Promise<Credentials>;
  /** In development the SDK may use the developer's own login, so a quest can start without a key. */
  development: boolean;
  storeApiKey(key: string): PromiseLike<void>;
  validateKey(): KeyValidator;
  openApiKeyPage(): void;
  openWorktree(): void;
  post(event: HostEvent): void;
  /** The Guild Hall's rules (#179). */
  settings: GuildSettings;
  /** VS Code's settings, filtered to Ibitsa. */
  openSettings(): void;
  /** Opens a file in the editor; `openable` already checked it's one the webview may open. */
  openFile(path: string): void;
  /** Folders whose files the webview may open: the workspace, the skills folders, the plugin (#179). */
  openable: { workspace: string | undefined; roots: readonly string[] };
}
