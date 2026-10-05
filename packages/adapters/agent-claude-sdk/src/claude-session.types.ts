import type { AgentEvent } from '@ibitsa/protocol';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface ClaudeSessionInit {
  adapter: ClaudeAdapterOptions;
  cwd: string;
  classId: string;
  session: { sessionId: string } | { resume: string };
  prompt?: string;
  maxBudgetMicroUsd?: number;
  onEvent: (event: AgentEvent) => void;
}

/** A tool call waiting for the user, settled by an answer from "Needs you". */
export type Pending =
  | {
      kind: 'permission';
      input: Record<string, unknown>;
      resolve: (answer: PermissionAnswer) => void;
    }
  | {
      kind: 'question';
      input: Record<string, unknown>;
      resolve: (answers: Record<string, string>) => void;
    };

export interface PermissionAnswer {
  decision: 'allow' | 'deny';
  note?: string;
}
