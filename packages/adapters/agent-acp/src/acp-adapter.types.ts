import type { Readable, Writable } from 'node:stream';
import type { McpServer } from '@agentclientprotocol/sdk';
import type { NetworkRequest } from './sandbox.types';
import type { ToolHost } from './tool-bridge.types.ts';

/** USD per million tokens, for estimating gold when an agent reports tokens but no cost (§11.5). */
export interface AgentPrices {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** One ACP agent as `ibitsa.agents` describes it (§11.5): how to start it, and its prices if known. */
export interface AgentSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  prices?: AgentPrices;
  /** The agent's own mode to switch to once the session starts (Codex's `agent-full-access` under the sandbox, #200). */
  mode?: string;
}

/** What the adapter asks to start: one agent process per hero, in the hero's worktree. */
export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  /** Asks "Needs you" whether the agent may reach a new domain; only a sandbox asks (#200). */
  ask?: (request: NetworkRequest) => Promise<boolean>;
}

/** The started process, as much of Node's `ChildProcess` as the adapter uses. */
export interface AgentProcess {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * What the party check found starting the agent (§11.5, #199), before the extension adds what it
 * knows (installed or not, its sign-in command).
 */
export type AgentProbe =
  /** A session started; `models` are its `model` option's values, null when it offers none. */
  | { kind: 'ready'; models: string[] | null }
  /**
   * `session/new` answered `auth_required`. `terminal`: the agent's own terminal sign-in, to run as the
   * agent's command with these arguments and environment added; null when it offers none.
   */
  | {
      kind: 'signIn';
      message: string;
      terminal: { args: string[]; env: Record<string, string> } | null;
    }
  | { kind: 'failed'; message: string };

export interface AcpAdapterOptions {
  agent: AgentSpec;
  /** The environment heroes start from (§11.6, #67); the agent's own `env` goes on top. */
  env?: () => Record<string, string | undefined>;
  /** Starts the agent's process. The default spawns it directly; a sandbox wraps it (#200). */
  spawn?: (request: SpawnRequest) => AgentProcess;
  /**
   * Whether `spawn` runs the agent inside Ibitsa's sandbox (§11.5, #200). Without it, nothing of
   * Ibitsa's keeps the hard limits, so auto mode never answers this agent's requests.
   */
  sandboxed?: boolean;
  /**
   * Offers heroes Ibitsa's tools (`submit_task`) through the MCP tool bridge (#197). Without it a hero
   * can't submit, and the user marks the task done.
   */
  tools?: ToolHost;
  /** Other MCP servers for a hero's session, after the bridge. None by default. */
  mcpServers?: (session: { heroId: string; cwd: string }) => McpServer[];
}
