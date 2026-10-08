import type { HostEvent } from '@ibitsa/protocol';
import type { AgentChecks } from './agent-checks';
import type { SignInTerminal } from './agent-checks.types';
import type { Armory } from './armory';
import type { Credentials } from './credentials.types';
import type { GuildCouncil } from './guild-council';
import type { GuildSettings } from './guild-settings';
import type { KeyValidator } from './key-validator.types';
import type { PackLibrary } from './packs';

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
  /** The Guild Hall's Roster (#181). */
  council: GuildCouncil;
  /** VS Code's settings, filtered to Ibitsa. */
  openSettings(): void;
  /** Opens a file in the editor; `openable` already checked it's one the webview may open. */
  openFile(path: string): void;
  /** The asset packs found (#183). */
  packs: PackLibrary;
  /** `ibitsa.pack`: the pack in use. */
  activePack(): string;
  /** Writes `ibitsa.pack` to the user's settings. */
  setActivePack(id: string): PromiseLike<void>;
  /** A pack folder's address for the webview, ending in `/`. */
  packBase(dir: string): string;
  /** Folders whose files the webview may open: the workspace, the skills folders, the plugin (#179). */
  openable: { workspace: string | undefined; roots: readonly string[] };
  /** The Guild Hall's Armory (#182): classes and recolors. */
  armory: Armory;
  /** The party check of ACP agents (§11.5, #199). */
  agentChecks: AgentChecks;
  /** Opens a VS Code terminal and types the command into it (Sign in, #199). */
  openTerminal(terminal: SignInTerminal): void;
}
