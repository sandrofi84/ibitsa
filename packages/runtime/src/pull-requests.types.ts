import type { Effect, GameMasterEvent } from '@ibitsa/core';
import type { Clock, GameMaster, GitHost } from './ports.types';

export interface PullRequestsOptions {
  gameMaster: GameMaster;
  gitHost?: GitHost | undefined;
  clock: Clock;
  /** Read before each poll, so a changed setting applies at the next one. */
  pollSeconds: () => number;
  /** A result for core, logged like any game master event. */
  report: (event: GameMasterEvent) => void;
}

/** The effects `PullRequests` carries out. */
export type PullRequestEffect = Extract<
  Effect,
  {
    type:
      | 'pushBranch'
      | 'openPullRequest'
      | 'markPullRequestReady'
      | 'watchPullRequests'
      | 'pollPullRequests';
  }
>;
