import type { AgentAdapter, Clock, GameMaster, GitHost, UserSettings } from './ports.types';
import type { FolderWatcher } from './skill-catalog.types';

export interface RuntimeOptions {
  storageDir: string;
  adapter: AgentAdapter;
  gameMaster: GameMaster;
  clock: Clock;
  /** Read when a quest starts; defaults to no cap and the default stall thresholds. */
  settings?: () => UserSettings;
  /** Campaign ids; injectable for tests. */
  newId?: () => string;
  /** Defaults to the real one; native Windows has no hero sandbox, which the game warns about (#63). */
  platform?: NodeJS.Platform;
  /** The user's home, for personal skills in the `/` menu (#84); defaults to the real one. */
  home?: string;
  /** The workspace repository, where project-scope actions are saved (#86). */
  repoDir?: string;
  /** The elder's model and cap (spec §4.1); Haiku and $0.25 by default. */
  elder?: () => { model: string; budgetMicroUsd: number };
  /** `ibitsa.council.mode` (§4.2, #103); `ask` by default. */
  councilMode?: () => 'ask' | 'roundTable' | 'chambers';
  /** Councillor ids the user turned off (§4.7, #98); read each time the roster is asked for. */
  disabledCouncillors?: () => string[];
  /** The git host for pull requests (§5.6, M6); without one, only pushing works. */
  gitHost?: GitHost;
  /** `ibitsa.pullRequests.pollSeconds` (§5.6); 60 by default. */
  pullRequestPollSeconds?: () => number;
  /** How skill folders are watched; injectable for tests. */
  watchFolder?: FolderWatcher;
}

export interface Connection {
  /** Raw message from the front end; validated here because it crosses a trust boundary. */
  receive(raw: unknown): void;
  close(): void;
}
