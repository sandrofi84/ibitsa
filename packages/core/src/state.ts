import type {
  ActivityKind,
  AskUserQuestion,
  MicroUsd,
  Reading,
  TaskPointState,
} from '@ibitsa/protocol';

/** Core's own state. Plain JSON so it can be cloned, compared and rebuilt by replay. */
export interface CoreState {
  nextId: number;
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
  | { kind: 'reply'; id: string; heroId: string; text: string };

export function initialState(): CoreState {
  return { nextId: 1, campaign: null, islands: [], heroes: [], needsYou: [] };
}
