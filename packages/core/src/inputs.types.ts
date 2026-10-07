import type {
  AgentEvent,
  CheckResult,
  Command,
  CouncilEvent,
  ElderEvent,
  PolledPullRequest,
  PullRequestState,
  ReviewEvent,
} from '@ibitsa/protocol';
import type { QuestSettings } from './state.types';

/** Results of the game master's own work, reported by the runtime (spec §11.2). */
export type GameMasterEvent =
  | { type: 'worktreeCreated'; islandId: string; path: string; branch: string }
  | { type: 'worktreeFailed'; islandId: string; message: string }
  /** Outcome of the submit check (§5.5): clean worktree with at least one commit beyond its base. */
  | {
      type: 'submitChecked';
      heroId: string;
      toolUseId: string;
      ok: boolean;
      reason?: string;
      /** The branch head that was submitted (M5): reviewers review up to it. */
      head?: string;
    }
  /** The checks for a submitted task (§5.5), in the order run; it stops at the first failure. */
  | { type: 'checksRan'; taskPointId: string; results: CheckResult[] }
  /** Settings for the next quest, logged right before `startQuest`. */
  | ({ type: 'questSettings' } & QuestSettings)
  /** Hash of the worktree diff after a turn, for the no-progress rule. */
  | { type: 'diffObserved'; heroId: string; hash: string }
  | { type: 'worktreeRemoved'; islandId: string }
  | { type: 'worktreeRemoveFailed'; islandId: string; commandId: string; reason: string }
  /** The result of `rebaseWorktree` (#121): already up to date, rebased cleanly, or aborted on a conflict. */
  | { type: 'worktreeRebased'; islandId: string; outcome: 'upToDate' | 'rebased' | 'conflict' }
  /** The council version of a sitting whose session started (§4.10); noted by the runtime. */
  | { type: 'councilVersionNoted'; sittingId: string; version: string }
  /** The island's branch was pushed (§5.6): `head` is the commit pushed. */
  | { type: 'branchPushed'; islandId: string; head: string }
  | {
      type: 'pullRequestOpened';
      islandId: string;
      head: string;
      number: number;
      url: string;
      state: PullRequestState;
    }
  | { type: 'pullRequestReady'; islandId: string; head: string }
  /** A push or PR action failed: shown on the island's PR card. */
  | { type: 'remoteFailed'; islandId: string; message: string }
  /** The git host's answer for the PRs being watched. */
  | { type: 'pullRequestsPolled'; pullRequests: PolledPullRequest[] }
  /** The runtime rebuilt state after a restart; every live session is gone (spec §12). */
  | { type: 'runtimeRestarted' };

/**
 * Everything core reacts to. `t` is milliseconds since the campaign's log header and is core's only clock
 * (ADR 0001). The runtime appends each input to the event log before stepping.
 */
export type CoreInput =
  | { kind: 'agent'; t: number; heroId: string; event: AgentEvent }
  /** From a reviewer's session (§5.5); ignored unless `reviewId` is a running review. */
  | { kind: 'review'; t: number; reviewId: string; event: ReviewEvent }
  /** From the elder's research session; ignored unless `elderId` is the current research. */
  | { kind: 'elder'; t: number; elderId: string; event: ElderEvent }
  /** From a sitting's lead session; ignored unless `sittingId` is the current sitting. */
  | { kind: 'council'; t: number; sittingId: string; event: CouncilEvent }
  | { kind: 'command'; t: number; command: Command }
  | { kind: 'gm'; t: number; event: GameMasterEvent }
  | { kind: 'timer'; t: number; timerId: string };
