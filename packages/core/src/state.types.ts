import type {
  ActivityKind,
  AskUserQuestion,
  CouncilAnswer,
  CouncilQuestion,
  CouncilReport,
  DialogueLine,
  Effort,
  ElderStatus,
  MicroUsd,
  ModelUsage,
  PlanOutcome,
  PlanProposal,
  Reading,
  ResearchBrief,
  SittingMode,
  SittingRating,
  SittingStatus,
  TaskPointState,
} from '@ibitsa/protocol';

/** Settings that shape the rules, logged as a `questSettings` input before each quest starts. */
export interface QuestSettings {
  /** The hero's gold pouch; `null` = no cap. */
  budgetMicroUsd: number | null;
  /** What the agent can do about a cap (spec §7.3): stop natively, report cost only, or neither. */
  budget: 'native' | 'turnEnd' | 'none';
  /** Stall thresholds (spec §10 item 11). */
  stall: { testFailures: number; fileEdits: number; noProgressTurns: number };
}

/** Core's own state. Plain JSON so it can be cloned, compared and rebuilt by replay. */
export interface CoreState {
  nextId: number;
  settings: QuestSettings;
  campaign: Campaign | null;
  /** The elder's research for this campaign (spec §4.1). */
  elder: ElderRecord | null;
  /** The council's current or last sitting (spec §4.3). */
  sitting: SittingRecord | null;
  /** Earlier sittings in this campaign, oldest first: kept for their tallies (§4.10). */
  pastSittings: SittingRecord[];
  islands: Island[];
  heroes: HeroRecord[];
  needsYou: PendingItem[];
}

export interface Campaign {
  id: string;
  title: string;
  /** `planning` while the elder (and later the council) works, before any hero exists. */
  status: 'planning' | 'active' | 'finished' | 'abandoned';
  /** Auto mode (#63): permissions inside the hard limits are allowed without asking. */
  autoApprove: boolean;
}

export interface Island {
  id: string;
  name: string;
  branch: string;
  baseRef: string;
  worktreePath: string | null;
  /** Set once "Remove worktree" succeeds; `worktreePath` is null both before creation and after. */
  worktreeRemoved: boolean;
  /** `description` is the task text the hero is started with; `briefing` follows it, from the elder's brief. */
  taskPoints: {
    id: string;
    title: string;
    description: string;
    briefing?: string;
    state: TaskPointState;
  }[];
}

export interface RunningTool {
  toolUseId: string;
  kind: ActivityKind;
  detail?: string;
}

/** Raw facts about a hero, kept as plain data; the `Hero` class gives them behaviour (ADR 0002). */
export interface HeroRecord {
  id: string;
  name: string;
  classId: string;
  islandId: string;
  taskPointId: string | null;
  sessionStarted: boolean;
  inTurn: boolean;
  runningTools: RunningTool[];
  lastMessage: string | null;
  resting: boolean;
  /** A `submit_task` call waiting for the submit check. */
  pendingSubmit: { toolUseId: string; summary: string } | null;
  submitted: { summary: string } | null;
  unknownReason: string | null;
  error: string | null;
  outOfGold: boolean;
  hp: Reading<{ used: number; max: number }>;
  gold: Reading<MicroUsd>;
  queuedMessages: number;
  /** From `sessionStarted`; used to resume. */
  sessionId: string | null;
  /** "Always allow for this quest" rules (#62), passed again when the session resumes. */
  allowRules: string[];
  /** False after a restart until the session is resumed. */
  sessionLive: boolean;
  stalled: string | null;
  /** The gold pouch, if a cap is set and can be enforced. */
  cap: { microUsd: number; enforcement: 'native' | 'turnEnd' } | null;
  watch: StallWatch;
}

/** Counters behind the stall rules (spec §10 item 11). */
export interface StallWatch {
  failingTest: { command: string; count: number } | null;
  editsSincePass: Record<string, number>;
  passedThisTurn: boolean;
  lastDiff: string | null;
  quietTurns: number;
}

/** Raw facts about a sitting; the `Sitting` class gives them behaviour (ADR 0002). */
export interface SittingRecord {
  id: string;
  task: string;
  mode: SittingMode;
  status: SittingStatus;
  effort: Effort;
  /** Fixed when the council convenes; `addCouncillor` is the only way to grow it. */
  roster: { councillorId: string; effort: Effort }[];
  sessionId: string | null;
  reports: { id: string; councillorId: string; revision: number; report: CouncilReport }[];
  batches: QuestionBatch[];
  plans: { version: number; plan: PlanProposal; outcome: PlanOutcome }[];
  /** Change requests so far. */
  revision: number;
  reconsultations: { councillorId: string; revision: number; reportId: string }[];
  /** "Why?" and the answers to it (§4.4). Ids count lines, so asking doesn't shift other ids. */
  dialogue: DialogueLine[];
  gold: Reading<MicroUsd>;
  error: string | null;
  /** Core's clock (`t`) when convened and when it ended: the tally's time taken (#106). */
  startedAt: number;
  endedAt: number | null;
  /** Noted by the runtime when the session starts (§4.10). */
  councilVersion: string | null;
  comparisonOf: string | null;
  rating: SittingRating | null;
  usage: { byModel: ModelUsage[]; byCouncillor: { councillorId: string; tokens: number }[] };
  /** What the elder's brief recommended when the council convened; null without a brief. */
  elderPicks: {
    effort: Effort;
    councillors: { councillorId: string; effort: Effort | null }[];
  } | null;
}

/** One `ask_user` call; `answers` stays null until the user answers. */
export interface QuestionBatch {
  id: string;
  toolUseId: string;
  items: (CouncilQuestion & { id: string })[];
  answers: CouncilAnswer[] | null;
}

export type PendingItem =
  | {
      kind: 'permission';
      id: string;
      heroId: string;
      requestId: string;
      action: string;
      target: string;
      cwd: string;
      /** The rules "Always allow" would add (#62); empty when it isn't offered. */
      alwaysAllow: string[];
    }
  | {
      kind: 'question';
      id: string;
      heroId: string;
      requestId: string;
      questions: AskUserQuestion[];
    }
  | { kind: 'reply'; id: string; heroId: string; text: string }
  | { kind: 'stalled'; id: string; heroId: string; reason: string }
  | {
      kind: 'outOfGold';
      id: string;
      heroId: string;
      cap: MicroUsd;
      capEnforcement: 'native' | 'turnEnd';
    }
  | { kind: 'error'; id: string; heroId: string; message: string };

/** Raw facts about the elder's research; the `Elder` class gives them behaviour (ADR 0002). */
export interface ElderRecord {
  id: string;
  task: string;
  status: ElderStatus;
  progress: string | null;
  brief: ResearchBrief | null;
  gold: Reading<MicroUsd>;
  error: string | null;
  sessionId: string | null;
  startedAt: number;
  endedAt: number | null;
}
