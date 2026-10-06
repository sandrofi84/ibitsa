import type { GameMasterEvent } from '@ibitsa/core';
import type {
  ActionDraft,
  ActionInfo,
  AgentEvent,
  CoreMessage,
  CouncilAnswer,
  CouncilEvent,
  CouncillorInfo,
  Effort,
  ElderEvent,
  RepoView,
  ResearchBrief,
  SittingMessage,
  SittingMode,
} from '@ibitsa/protocol';

/** Starting one hero's agent session (spec §11.3). The adapter reports everything through `onEvent`. */
export interface SessionStart {
  heroId: string;
  /** Chosen up front so it is logged before the first event (§12). */
  sessionId: string;
  cwd: string;
  classId: string;
  prompt: string;
  /** For adapters with a native cap: what is left of the gold pouch (spec §7.3). */
  maxBudgetMicroUsd?: number;
  /** Rules allowed without asking: this quest's and the project's "Always allow" (#62). */
  allowRules?: string[];
}

export interface SessionResume {
  heroId: string;
  sessionId: string;
  cwd: string;
  classId: string;
  /** Sent after resuming when interrupted work should continue. */
  prompt?: string;
  maxBudgetMicroUsd?: number;
  allowRules?: string[];
}

export interface AgentSession {
  send(text: string, priority: 'now' | 'next'): void;
  /** Interrupt and drop anything the adapter is holding (a full stop). */
  interrupt(): void;
  /** Compact the session to free context (Rest, #82). */
  compact(): void;
  /** `always`: also allow the request's suggested rules for the rest of the session (#62). */
  respondToPermission(answer: {
    requestId: string;
    decision: 'allow' | 'deny';
    note?: string;
    always?: boolean;
  }): void;
  answerQuestion(requestId: string, answers: Record<string, string | string[]>): void;
  completeSubmit(result: { toolUseId: string; accepted: boolean; reason?: string }): void;
  close(): void;
}

export interface AgentAdapter {
  /** What the agent can do about cost (spec §7.3, §11.3). */
  capabilities: { budgetCap: boolean; costReported: boolean };
  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession;
  resumeSession(resume: SessionResume, onEvent: (event: AgentEvent) => void): AgentSession;
  /** The `/` menu's actions for a folder (#84); adapters without skills leave it out. */
  listActions?(request: { cwd: string }): Promise<ActionInfo[]>;
  /** An action's expanded prompt for the preview (#85); null when its file can't be read. */
  previewAction?(request: {
    cwd: string;
    name: string;
    args: string;
  }): Promise<{ text: string; notes: string[] } | null>;
  /** The elder's research session (spec §4.1, #101); adapters that can't run it leave it out. */
  startElder?(start: ElderStart, onEvent: (event: ElderEvent) => void): { close(): void };
  /** A short hash of the adapter's council prompts, part of the council version (§4.10, #106). */
  councilPromptVersion?: string;
  /** A sitting's lead session (spec §4.3, #103); adapters that can't run one leave it out. */
  startSitting?(start: SittingStart, onEvent: (event: CouncilEvent) => void): SittingSession;
  /** The councillors a folder can seat (§4.7, #98); adapters without skills leave it out. */
  listCouncillors?(request: { cwd: string }): Promise<CouncillorInfo[]>;
  /** Writes a new action (#86); adapters without skills leave it out. */
  createAction?(request: CreateActionRequest): Promise<CreateActionResult>;
}

/** Starting the elder's research (spec §4.1): read-only, capped, ending with `submit_brief`. */
export interface ElderStart {
  /** The workspace repository it researches. */
  cwd: string;
  task: string;
  /** Who it may recommend; the brief may name no one else. */
  councillors: readonly CouncillorInfo[];
  /** A model alias or id; Haiku by default. */
  model: string;
  maxBudgetMicroUsd: number;
}

/** Starting a sitting's lead session (spec §4.3): read-only, capped, with the council's tools. */
export interface SittingStart {
  /** The workspace repository the council plans for. */
  cwd: string;
  mode: SittingMode;
  task: string;
  /** The elder's brief, when there is one: the sitting starts from it (§4.1). */
  brief: ResearchBrief | null;
  /** In separate chambers each councillor also has its own model, from its effort (§4.2). */
  roster: readonly { councillorId: string; effort: Effort; model?: string }[];
  /** From the sitting's effort (§4.2); in separate chambers, the chairing elder's. */
  model: string;
  maxBudgetMicroUsd: number;
}

/** A running sitting: core's answers to its tool calls and what the user did go back through it. */
export interface SittingSession {
  /** The user asked for changes, added a councillor, or asked "Why?". */
  message(message: SittingMessage): void;
  /** Core's verdict on a `report`, `ask_user` or `propose_plan` call. */
  completeTool(result: { toolUseId: string; accepted: boolean; reason?: string }): void;
  /** The user's answers to an accepted `ask_user` batch, in question order. */
  answer(result: { toolUseId: string; answers: CouncilAnswer[] }): void;
  close(): void;
}

/** A new action to write, and where each scope keeps its skills. */
export interface CreateActionRequest {
  draft: ActionDraft;
  overwrite: boolean;
  roots: { personal: string; project: string };
}

export type CreateActionResult =
  | { ok: true; path: string }
  | { ok: false; reason: string; clash: boolean };

/** The game master's own work in the repo (spec §5.3, §5.5); results come back as core inputs. */
export interface GameMaster {
  createWorktree(request: {
    islandId: string;
    branch: string;
    baseRef: string;
  }): Promise<GameMasterEvent>;
  checkSubmit(request: {
    heroId: string;
    toolUseId: string;
    worktreePath: string;
    baseRef: string;
  }): Promise<GameMasterEvent>;
  /** A hash of the worktree's diff against HEAD, for the no-progress stall rule. */
  observeDiff(request: { worktreePath: string }): Promise<string>;
  /** Removes the worktree if it is clean. */
  removeWorktree(request: {
    worktreePath: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
  /** Default branch, local branches and uncommitted changes of the workspace; null if not a git repo. */
  scanRepo(): Promise<RepoView | null>;
  /** The worktree's files, tracked and untracked but not ignored, for @ references (#83). */
  listFiles(request: { worktreePath: string }): Promise<string[]>;
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** A connected front end (a webview, later a daemon client). */
export interface FrontEnd {
  post(message: CoreMessage): void;
}

/** Settings the user controls; the runtime logs them before each quest starts. */
export interface UserSettings {
  budgetMicroUsd: number | null;
  stall: { testFailures: number; fileEdits: number; noProgressTurns: number };
}
