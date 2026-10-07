import type { CouncillorInfo } from './councillors.types';
import type { ElderView } from './elder.types';
import type { GitHostView, IslandRemoteView, PullRequestDraft } from './pull-request.types';
import type { Finding } from './review.schema';
import type { TaskReviewView } from './review.types';
import type { SittingView } from './sitting.types';
import type { MicroUsd, Reading } from './values.types';

/** The whole world as front ends see it: glossary terms, no layout (spec §11.2.1). */
export interface Snapshot {
  campaign: CampaignView | null;
  /** The elder's research for this campaign (spec §4.1); null before asking it. */
  elder: ElderView | null;
  /** The council's current or last sitting (spec §4.3); null before the first. */
  sitting: SittingView | null;
  islands: IslandView[];
  heroes: HeroView[];
  /** Oldest first. */
  needsYou: NeedsYouItem[];
  /** The workspace repository, for the New Quest form. Added by the runtime, not core; null if not a git repo. */
  repo?: RepoView | null;
  /** "Always allow in this project" rules (#62), passed to every hero session. Added by the runtime. */
  projectRules?: string[];
  /** Whether hero shell commands run in an OS sandbox here (not on native Windows). Added by the runtime. */
  sandboxed?: boolean;
  /** The councillors the workspace can seat (§4.7), for convening and the hut. Added by the runtime. */
  councillors?: CouncillorInfo[];
  /** `ibitsa.council.mode`: ask how the council sits each time, or always one way (§4.2). Added by the runtime. */
  councilMode?: 'ask' | 'roundTable' | 'chambers';
  /** What the git host allows here (§5.6, #162); absent until known. Added by the runtime. */
  gitHost?: GitHostView;
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
  /** `planning` while the elder (and later the council) works, before any hero; `active` once one does. */
  status: 'planning' | 'active' | 'finished' | 'abandoned';
  /** Computed by core; front ends never sum hero gold themselves. */
  gold: Reading<MicroUsd>;
  /** Auto mode (#63): permissions inside the worktree and the sandbox are allowed without asking. */
  autoApprove: boolean;
  /** How the islands branch (§5.3); separate for a quick quest. */
  branching: 'separate' | 'stacked';
  /** Stacked only: each island when the one before is cleared, or all at once (#121). */
  stackedStart: 'cleared' | 'together' | null;
  /** `ibitsa.campaign.budgetUsd` (§14.3); null for none. */
  capMicroUsd: MicroUsd | null;
  /** `ibitsa.parties.maxParallel` (§5.1): how many parties work at once (#123). */
  maxParallel: number;
  /** Every island's PR is merged (§5.6): the heroes reach Ibitsa and Finish is offered. */
  shipped: boolean;
}

export interface IslandView {
  id: string;
  name: string;
  branch: string;
  /** The hero's worktree: not started yet (#121), being created, there, or removed after the quest (#40). */
  worktree: 'waiting' | 'creating' | 'ready' | 'removed';
  /** Stacked: the island this one builds on (#121). */
  basedOn: string | null;
  /** Stacked, all at once: the branch it builds on has moved on and rebasing conflicted (#121). */
  behind: boolean;
  taskPoints: TaskPointView[];
  /** Its branch on the git host and its PR (M6); null before anything was pushed. */
  remote: IslandRemoteView | null;
  /** What the PR preview starts from, until a PR is open; null once there is one. */
  pullRequestDraft: PullRequestDraft | null;
}

/** §7.2 task point states, plus M1's done-without-review (§14.1). */
export type TaskPointState = 'locked' | 'active' | 'underReview' | 'done' | 'doneUnreviewed';

export interface TaskPointView {
  id: string;
  title: string;
  state: TaskPointState;
  /** Its checks and reviews, once submitted (M5). */
  review?: TaskReviewView | null;
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
  /** Its task is being checked or reviewed (M5): it waits for the verdicts. */
  | { kind: 'underReview' }
  /**
   * Can't start yet (#121): every parallel slot is taken, the island before it (stacked) isn't cleared,
   * or its next task depends on a task on another island that isn't done.
   */
  | { kind: 'blocked'; reason: 'slot' | 'previousIsland' | 'dependency' }
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
  | {
      kind: 'permission';
      id: string;
      heroId: string;
      action: string;
      target: string;
      cwd: string;
      /** The rules "Always allow" would add (#62); empty when it isn't offered. */
      alwaysAllow: string[];
    }
  /** answerQuestion */
  | { kind: 'question'; id: string; heroId: string; questions: AskUserQuestion[] }
  /** sendMessage or markDone */
  | { kind: 'reply'; id: string; heroId: string; text: string }
  /** resumeHero, sendMessage or stopHero */
  | { kind: 'stalled'; id: string; heroId: string; reason: string }
  /** resolveReview: the loop limit, or a reviewer that couldn't finish (§5.5, #136). */
  | {
      kind: 'reviewEscalation';
      id: string;
      heroId: string;
      taskPointId: string;
      reason: 'loopLimit' | 'reviewFailed';
      /** The open blocking findings, by councillor. */
      findings: (Finding & { councillorId: string })[];
    }
  /** dismiss: "Revisit D3?" from a reviewer; a recorded decision is the user's to reopen (§4.5). */
  | {
      kind: 'revisitDecision';
      id: string;
      heroId: string;
      councillorId: string;
      decisionId: string;
      message: string;
    }
  /** resolveDispute: the hero says findings contradict each other or a decision. */
  | {
      kind: 'dispute';
      id: string;
      heroId: string;
      taskPointId: string;
      reason: string;
      findings: (Finding & { councillorId: string })[];
    }
  /** raiseBudget or stopHero */
  | {
      kind: 'outOfGold';
      id: string;
      heroId: string;
      cap: MicroUsd;
      capEnforcement: 'native' | 'turnEnd';
      /** `campaign` when the whole campaign's cap stopped the hero (§14.3, #121). */
      scope?: 'hero' | 'campaign';
    }
  /** resumeHero or stopHero */
  | { kind: 'error'; id: string; heroId: string; message: string };
