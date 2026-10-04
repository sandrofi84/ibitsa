import type { CoreState, GameMasterEvent } from '@ibitsa/core';
import type { AgentEvent, CoreMessage } from '@ibitsa/protocol';

/** Starting one hero's agent session (spec §11.3). The adapter reports everything through `onEvent`. */
export interface SessionStart {
  heroId: string;
  /** Chosen up front so it is logged before the first event (§12). */
  sessionId: string;
  cwd: string;
  classId: string;
  prompt: string;
}

export interface AgentSession {
  send(text: string, priority: 'now' | 'next'): void;
  /** Interrupt and drop anything the adapter is holding (a full stop). */
  interrupt(): void;
  respondToPermission(requestId: string, decision: 'allow' | 'deny', note?: string): void;
  answerQuestion(requestId: string, answers: Record<string, string | string[]>): void;
  completeSubmit(toolUseId: string, accepted: boolean, reason?: string): void;
  close(): void;
}

export interface AgentAdapter {
  startSession(start: SessionStart, onEvent: (event: AgentEvent) => void): AgentSession;
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
}

export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

/** A connected front end (a webview, later a daemon client). */
export interface FrontEnd {
  post(message: CoreMessage): void;
}

/** Read-only view of core state for effects that need context (e.g. a hero's worktree). */
export type StateReader = () => CoreState;
