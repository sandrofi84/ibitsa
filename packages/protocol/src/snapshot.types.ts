import type { MicroUsd, Reading } from './values.types';

/** The whole world as front ends see it: glossary terms, no layout (spec §11.2.1). */
export interface Snapshot {
  campaign: CampaignView | null;
  islands: IslandView[];
  heroes: HeroView[];
  /** Oldest first. */
  needsYou: NeedsYouItem[];
  /** The workspace repository, for the New Quest form. Added by the runtime, not core; null if not a git repo. */
  repo?: RepoView | null;
}

export interface RepoView {
  defaultBranch: string;
  /** Local branches, default first. */
  branches: string[];
  /** Uncommitted changes in the workspace: they won't be in a new worktree (spec §5.3). */
  uncommittedChanges: number;
}

export interface CampaignView {
  id: string;
  title: string;
  status: 'active' | 'finished' | 'abandoned';
  /** Computed by core; front ends never sum hero gold themselves. */
  gold: Reading<MicroUsd>;
}

export interface IslandView {
  id: string;
  name: string;
  branch: string;
  taskPoints: TaskPointView[];
}

/** §7.2 task point states, plus M1's done-without-review (§14.1). */
export type TaskPointState = 'locked' | 'active' | 'underReview' | 'done' | 'doneUnreviewed';

export interface TaskPointView {
  id: string;
  title: string;
  state: TaskPointState;
}

/** Exactly one per hero, derived from real agent events (§5.4). */
export type ExecutionState =
  | { kind: 'unknown'; reason: string }
  | { kind: 'error'; message: string }
  | { kind: 'outOfGold' }
  | { kind: 'stalled'; reason: string }
  | { kind: 'waitingOnYou' }
  | { kind: 'resting' }
  /** What the hero is doing is in `HeroView.activity`. */
  | { kind: 'working' }
  /** M4. */
  | { kind: 'blocked' }
  | { kind: 'submitted'; summary: string }
  | { kind: 'idle' }
  | { kind: 'traveling' };

export type ActivityKind = 'read' | 'search' | 'edit' | 'test' | 'run' | 'think' | 'other';

export interface HeroView {
  id: string;
  name: string;
  classId: string;
  islandId: string;
  taskPointId: string | null;
  state: ExecutionState;
  activity: { kind: ActivityKind; detail?: string } | null;
  hp: Reading<{ used: number; max: number }>;
  gold: Reading<MicroUsd>;
  queuedMessages: number;
}

/** A question as the agent asks it (mirrors the Claude SDK's AskUserQuestion shape). */
export interface AskUserQuestion {
  question: string;
  header: string;
  options: { label: string; description: string; preview?: string }[];
  multiSelect: boolean;
}

/** One entry in the "Needs you" queue; the comment names the commands that answer it. */
export type NeedsYouItem =
  /** answerPermission. `action`/`target` are rendered exactly from the tool input, never paraphrased. */
  | { kind: 'permission'; id: string; heroId: string; action: string; target: string; cwd: string }
  /** answerQuestion */
  | { kind: 'question'; id: string; heroId: string; questions: AskUserQuestion[] }
  /** sendMessage or markDone */
  | { kind: 'reply'; id: string; heroId: string; text: string }
  /** resumeHero, sendMessage or stopHero */
  | { kind: 'stalled'; id: string; heroId: string; reason: string }
  /** raiseBudget or stopHero */
  | {
      kind: 'outOfGold';
      id: string;
      heroId: string;
      cap: MicroUsd;
      capEnforcement: 'native' | 'turnEnd';
    }
  /** resumeHero or stopHero */
  | { kind: 'error'; id: string; heroId: string; message: string };
