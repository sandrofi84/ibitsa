import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '@ibitsa/protocol';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface ClaudeSessionInit {
  adapter: ClaudeAdapterOptions;
  cwd: string;
  classId: string;
  session: { sessionId: string } | { resume: string };
  prompt?: string;
  maxBudgetMicroUsd?: number;
  /** Rules allowed without asking: the quest's and the project's "Always allow" (#62). */
  allowRules: readonly string[];
  onEvent: (event: AgentEvent) => void;
}

/** A tool call waiting for the user, settled by an answer from "Needs you". */
export type Pending =
  | {
      kind: 'permission';
      input: Record<string, unknown>;
      /** What "Always allow" sends back: the SDK's own suggested rules, for this session. */
      updates: PermissionUpdate[];
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
  /** Also allow the request's suggested rules for the rest of the session (#62). */
  always?: boolean;
}
