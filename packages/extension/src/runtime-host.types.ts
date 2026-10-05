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
}) => Dependencies;

/** Shows a "Needs you" notification; resolves true when the user asks to open the game. */
export type Notifier = (message: string) => PromiseLike<boolean>;

export interface RuntimeHostOptions {
  storageDir: string;
  workspaceDir: string;
  dependencies: DependencyFactory;
  credentials: () => Promise<Credentials>;
  settings: () => UserSettings;
  notify: Notifier;
  /** Is the game tab on screen? Notifications only appear when it isn't. */
  gameVisible: () => boolean;
  openGame: () => void;
  /** The number of items waiting, for the tab title. */
  onWaitingChanged: (count: number) => void;
}
