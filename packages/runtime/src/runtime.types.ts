import type { HeroClassView, RecolorMap } from '@ibitsa/protocol';
import type { AgentAdapter, Clock, GameMaster, GitHost, UserSettings } from './ports.types';
import type { FolderWatcher } from './skill-catalog.types';

/** Spend caps the user set (#272), in micro-USD; null where they set none, the default. */
export interface SessionCaps {
  /** One sitting of the council, whichever way it sits. */
  sittingMicroUsd: number | null;
  /** One reviewer's review of one task. */
  reviewMicroUsd: number | null;
  /** The elder's lessons at a campaign's end. */
  lessonsMicroUsd: number | null;
}

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
  /** The elder's model and cap (spec §4.1); Haiku and no cap by default (#272). */
  elder?: () => { model: string; budgetMicroUsd: number | null };
  /** The user's caps for a sitting, a review and the lessons (#272); none by default. */
  caps?: () => SessionCaps;
  /** `ibitsa.council.mode` (§4.2, #103); `ask` by default. */
  councilMode?: () => 'ask' | 'roundTable' | 'chambers';
  /** Councillor ids the user turned off (§4.7, #98); read each time the roster is asked for. */
  disabledCouncillors?: () => string[];
  /** The git host for pull requests (§5.6, M6); without one, only pushing works. */
  gitHost?: GitHost;
  /** `ibitsa.pullRequests.pollSeconds` (§5.6); 60 by default. */
  pullRequestPollSeconds?: () => number;
  /** The hero classes in play (§5.2, #182); the built-ins by default. Read each time it's needed. */
  classes?: () => HeroClassView[];
  /**
   * The adapter for an ACP agent a class names (§11.5, #198), or why it can't run; undefined when
   * there's no such agent. Classes on `claude` use `adapter`.
   */
  agentAdapter?: (agentId: string) => AgentAdapter | { error: string } | undefined;
  /**
   * Whether heroes on an ACP agent run inside Ibitsa's sandbox (§11.5, #200); a class whose agent
   * doesn't is marked so in the snapshot. Without it, every class counts as sandboxed.
   */
  agentSandboxed?: (agentId: string) => boolean;
  /** `ibitsa.recolor` (#182), for the snapshot. */
  recolor?: () => RecolorMap;
  /** How skill folders are watched; injectable for tests. */
  watchFolder?: FolderWatcher;
}

export interface Connection {
  /** Raw message from the front end; validated here because it crosses a trust boundary. */
  receive(raw: unknown): void;
  close(): void;
}
