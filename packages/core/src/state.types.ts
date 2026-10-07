import type {
  ActivityKind,
  Amendment,
  AmendmentOutcome,
  AskUserQuestion,
  CampaignEndView,
  CheckResult,
  ConsultationView,
  CouncilAnswer,
  CouncilQuestion,
  CouncilReport,
  DialogueLine,
  Effort,
  ElderStatus,
  Finding,
  IslandRemoteView,
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
  Verdict,
} from '@ibitsa/protocol';

/** Settings that shape the rules, logged as a `questSettings` input before each quest starts. */
export interface QuestSettings {
  /** The hero's gold pouch; `null` = no cap. */
  budgetMicroUsd: number | null;
  /** What the agent can do about a cap (spec §7.3): stop natively, report cost only, or neither. */
  budget: 'native' | 'turnEnd' | 'none';
  /** Stall thresholds (spec §10 item 11). */
  stall: { testFailures: number; fileEdits: number; noProgressTurns: number };
  /** How many parties may work at once (§5.1, #121). */
  maxParallel: number;
  /** The whole campaign's cap (§14.3); `null` = none. */
  campaignBudgetMicroUsd: number | null;
  /** Whether submitted tasks are checked and reviewed (M5). Logs from before M5 have none. */
  reviews: boolean;
  /** Review rounds before a task goes to the user (§5.5). */
  loopLimit: number;
  /** The cap on one question to the council mid-campaign (§4.8, #169). */
  consultBudgetMicroUsd: number;
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
  /** How the islands branch (§5.3, #121). */
  branching: 'separate' | 'stacked';
  stackedStart: 'cleared' | 'together' | null;
  /** The base the first (or every separate) island branches from; null before any island. */
  baseRef: string | null;
  /** Once it's finished or abandoned (§4.9, #167): its record and the council's context. */
  ending?: CampaignEnd;
  /** "Revisit D…?" requests the user dismissed (§5.5): the record lists them as deferred. */
  revisitsDismissed?: { councillorId: string; decisionId: string; message: string }[];
}

/** The end of a campaign (§4.9): plain data; `CampaignRecord` gives it behaviour. */
export interface CampaignEnd {
  record: CampaignEndView['record'];
  recordPath: string | null;
  recordError: string | null;
  /** The elder's lessons session, while it runs; null when there was nothing to learn from. */
  lessonsId: string | null;
  lessons: string[] | null;
  lessonsGold: Reading<MicroUsd>;
  councilContext: CampaignEndView['councilContext'];
}

export interface Island {
  id: string;
  name: string;
  branch: string;
  baseRef: string;
  worktreePath: string | null;
  /** Set once "Remove worktree" succeeds; `worktreePath` is null both before creation and after. */
  worktreeRemoved: boolean;
  /** Whether its worktree has been asked for: an island waits for a slot, a dependency or (stacked) the one before (#121). */
  launched: boolean;
  /** Stacked: the island it branches from (#121). */
  basedOn: string | null;
  /** Stacked, all at once: rebasing onto `basedOn` conflicted and the hero was asked to resolve it. */
  behind: boolean;
  /** `description` is the task text the hero is started with; `briefing` follows it, from the elder's brief. */
  taskPoints: {
    id: string;
    title: string;
    description: string;
    briefing?: string;
    state: TaskPointState;
    /** The plan task it stands for, and the plan tasks it waits on (#121). */
    planTaskId?: string;
    dependsOn?: string[];
    /** The branch head when it was last submitted (M5): what reviewers review up to. */
    submitHead?: string | null;
    /** Its checks and reviews once submitted (M5). */
    review?: TaskReview | null;
  }[];
  /** Review effort per reviewing councillor, from party assembly (M5); Light when absent. */
  reviewEfforts?: Record<string, Effort>;
  /** Its branch on the git host and its PR (M6); absent before anything was pushed. */
  remote?: IslandRemote;
  /** The plan island it stands for (#170); absent in older logs, where the islands follow the plan's order. */
  planIslandId?: string;
  /** Added by an amendment (#170): it waits for its party (`assembleParty`) before it can start. */
  awaitingParty?: boolean;
}

/** An island's branch on the git host (§5.6): plain data; `PullRequest` gives it behaviour. */
export type IslandRemote = IslandRemoteView;

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
  /** Plan tasks on other islands its current task waits on; it gets the task once they're done (#121). */
  heldFor: string[];
  /** Stopped by the campaign's cap rather than its own pouch (#121). */
  campaignCapped: boolean;
  /** False after a restart until the session is resumed. */
  sessionLive: boolean;
  /** Stop was pressed and the interrupted turn hasn't ended yet (#166). */
  stopping?: boolean;
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
  /**
   * After a reload (#166): its lead session isn't running. It resumes when the user next acts, or at
   * once if it was deliberating; questions asked before the reload are answered as a message.
   */
  dormant?: boolean;
  comparisonOf: string | null;
  rating: SittingRating | null;
  usage: { byModel: ModelUsage[]; byCouncillor: { councillorId: string; tokens: number }[] };
  /** Questions to the council once its plan is approved (§4.8, #169); absent in older logs. */
  consultations?: ConsultationRecord[];
  /** Changes to the approved plan (§4.8, #170), oldest first; absent in older logs. */
  amendments?: AmendmentRecord[];
  /** What the elder's brief recommended when the council convened; null without a brief. */
  elderPicks: {
    effort: Effort;
    councillors: { councillorId: string; effort: Effort | null }[];
  } | null;
}

/** One question to the council mid-campaign (#169): plain data; `Consultation` gives it behaviour. */
export type ConsultationRecord = ConsultationView;

/** A change to the approved plan (#170): plain data; `PlanAmendment` gives it behaviour. */
export interface AmendmentRecord {
  number: number;
  amendment: Amendment;
  outcome: AmendmentOutcome;
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
      scope?: 'hero' | 'campaign';
    }
  | { kind: 'error'; id: string; heroId: string; message: string }
  | {
      kind: 'reviewEscalation';
      id: string;
      heroId: string;
      taskPointId: string;
      reason: 'loopLimit' | 'reviewFailed';
      findings: (Finding & { councillorId: string })[];
    }
  | {
      kind: 'revisitDecision';
      id: string;
      heroId: string;
      councillorId: string;
      decisionId: string;
      message: string;
    }
  | {
      kind: 'dispute';
      id: string;
      heroId: string;
      taskPointId: string;
      reason: string;
      findings: (Finding & { councillorId: string })[];
      /** The reviews whose blocking findings are disputed. */
      reviewIds: string[];
    };

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

/** A task's checks and reviews (§5.5); the `Review` class gives them behaviour. */
export interface TaskReview {
  round: number;
  phase: 'checks' | 'reviewing' | 'changes' | 'escalated' | 'passed';
  checks: CheckResult[] | null;
  reviews: ReviewRecord[];
  suggestions: (Finding & { councillorId: string })[];
  /** The hero's summary from its last submit. */
  summary: string;
  /**
   * The round PR comments reopened the task at (#154): every councillor with criteria reviews that
   * round, and the loop limit counts from it.
   */
  followUpRound?: number;
}

export interface ReviewRecord {
  id: string;
  councillorId: string;
  effort: Effort;
  round: number;
  status: 'running' | 'done' | 'failed';
  verdict: Verdict | null;
  error: string | null;
  gold: Reading<MicroUsd>;
  /** The head it reviewed up to, so a re-review sees only what changed since. */
  head: string | null;
  /** The user dropped its blocking findings after a dispute: it doesn't hold the task back. */
  waived: boolean;
}
