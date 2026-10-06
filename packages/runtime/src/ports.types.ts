import type { GameMasterEvent } from '@ibitsa/core';
import type { ActionInfo, AgentEvent, CoreMessage, RepoView } from '@ibitsa/protocol';

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
}

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
