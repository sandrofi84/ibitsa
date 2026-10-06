import type { Command } from '@ibitsa/protocol';
import type { AgentAdapter, GameMaster, UserSettings } from '@ibitsa/runtime';
import type { Credentials } from './credentials.types';

export interface Dependencies {
  adapter: AgentAdapter;
  gameMaster: GameMaster;
}

/** Builds the agent adapter and game master for a workspace. */
export type DependencyFactory = (inputs: {
  credentials: Credentials;
  workspaceDir: string;
  /** The environment hero sessions start from: a fresh login shell's when it resolves (#67). */
  env: Record<string, string | undefined>;
}) => Dependencies;

/** Shows a "Needs you" notification; resolves true when the user asks to open the game. */
export type Notifier = (message: string) => PromiseLike<boolean>;

export interface RuntimeHostOptions {
  storageDir: string;
  workspaceDir: string;
  dependencies: DependencyFactory;
  credentials: () => Promise<Credentials>;
  /** Resolved each time the runtime starts, so a window reload picks up a changed Node setup (#67). */
  environment: () => Promise<Record<string, string | undefined>>;
  settings: () => UserSettings;
  notify: Notifier;
  /** Is the game tab on screen? Notifications only appear when it isn't. */
  gameVisible: () => boolean;
  openGame: () => void;
  /** The number of items waiting, for the tab title. */
  onWaitingChanged: (count: number) => void;
}

/** A command without its id; the host numbers it (#87). */
export type CommandIntent = Command extends infer C
  ? C extends { commandId: string }
    ? Omit<C, 'commandId'>
    : never
  : never;
