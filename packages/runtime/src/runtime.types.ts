import type { AgentAdapter, Clock, GameMaster, UserSettings } from './ports.types';

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
}

export interface Connection {
  /** Raw message from the front end; validated here because it crosses a trust boundary. */
  receive(raw: unknown): void;
  close(): void;
}
