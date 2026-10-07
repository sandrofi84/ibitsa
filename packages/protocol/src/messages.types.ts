import type { ActionInfo, ActionPreview } from './actions.types';
import type { ChronicleEntry } from './chronicle.types';
import type { JournalEntry } from './journal.types';
import type { ActivityKind, Snapshot } from './snapshot.types';

/** Core → front end. `seq` is monotonic: drop stale snapshots and cues older than the shown snapshot. */
export type CoreMessage =
  | { type: 'welcome'; seq: number; protocolVersion: number }
  | { type: 'snapshot'; seq: number; snapshot: Snapshot }
  | { type: 'cue'; seq: number; cue: Cue }
  /**
   * The journal (#58). A page answers `requestJournal`: `entries` start at index `start` of `total`.
   * Appends go to every front end as entries are written; `start` 0 means a new campaign began.
   */
  | { type: 'journal'; seq: number; entries: JournalEntry[]; start: number; total: number }
  | { type: 'journalAppend'; seq: number; entries: JournalEntry[]; start: number }
  /** Answers `requestFiles` (#83): the worktree's files, tracked and untracked but not ignored. */
  | { type: 'files'; seq: number; islandId: string; paths: string[] }
  /**
   * The `/` menu's actions for a hero's folder (#84): answers `requestActions` (with its `heroId`, #125),
   * and again, without one, whenever a skill changes.
   */
  | { type: 'actions'; seq: number; actions: ActionInfo[]; heroId?: string }
  /** Answers `requestPreview` (#85), with its `heroId` (#125). */
  | { type: 'preview'; seq: number; preview: ActionPreview; heroId?: string }
  /** Answers `createAction` (#86): written, or refused (`clash` when the name is taken). */
  | { type: 'actionCreated'; seq: number; name: string }
  | { type: 'actionRejected'; seq: number; name: string; reason: string; clash: boolean }
  /** Answers `requestChronicle` (#179): past campaigns, newest first. */
  | { type: 'chronicle'; seq: number; campaigns: ChronicleEntry[] };

/** Fire-and-forget effects (animation, sound, toast). Carry no state: dropping any cue must be harmless. */
export type Cue =
  | { type: 'commandRejected'; commandId: string; reason: string }
  | { type: 'needsYouAdded'; itemId: string }
  | { type: 'activityFinished'; heroId: string; kind: ActivityKind; outcome: 'ok' | 'failed' }
  | { type: 'retrying'; heroId: string; reason: string }
  /** The hero said something; the game shows an excerpt in a speech bubble (#57). */
  | { type: 'heroSaid'; heroId: string; text: string }
  /** VS Code reloaded (#166): what resumed on its own, for a one-time banner. */
  | {
      type: 'resumed';
      heroIds: string[];
      reviews: number;
      checks: number;
      council: boolean;
      elder: boolean;
    };
