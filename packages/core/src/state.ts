import type {
  ActivityKind,
  AskUserQuestion,
  MicroUsd,
  Reading,
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

export const DEFAULT_SETTINGS: QuestSettings = {
  budgetMicroUsd: null,
  budget: 'native',
  stall: { testFailures: 4, fileEdits: 12, noProgressTurns: 6 },
};

/** Core's own state. Plain JSON so it can be cloned, compared and rebuilt by replay. */
export interface CoreState {
  nextId: number;
  settings: QuestSettings;
  campaign: Campaign | null;
  islands: Island[];
  heroes: Hero[];
  needsYou: PendingItem[];
}

export interface Campaign {
  id: string;
  title: string;
  status: 'active' | 'finished' | 'abandoned';
}

export interface Island {
  id: string;
  name: string;
  branch: string;
  baseRef: string;
  worktreePath: string | null;
  /** `description` is the task text the hero is started with. */
  taskPoints: { id: string; title: string; description: string; state: TaskPointState }[];
}

export interface RunningTool {
  toolUseId: string;
  kind: ActivityKind;
  detail?: string;
}

/** Raw facts about a hero; `deriveState` turns them into one execution state (§5.4). */
export interface Hero {
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

export function freshWatch(): StallWatch {
  return {
    failingTest: null,
    editsSincePass: {},
    passedThisTurn: false,
    lastDiff: null,
    quietTurns: 0,
  };
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

export function initialState(): CoreState {
  return {
    nextId: 1,
    settings: DEFAULT_SETTINGS,
    campaign: null,
    islands: [],
    heroes: [],
    needsYou: [],
  };
}
