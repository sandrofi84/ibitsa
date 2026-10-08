import type { Readable, Writable } from 'node:stream';
import type { McpServer } from '@agentclientprotocol/sdk';
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
}

/** What the adapter asks to start: one agent process per hero, in the hero's worktree. */
export interface SpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string | undefined>;
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

export interface AcpAdapterOptions {
  agent: AgentSpec;
  /** The environment heroes start from (§11.6, #67); the agent's own `env` goes on top. */
  env?: () => Record<string, string | undefined>;
  /** Starts the agent's process. The default spawns it directly; #200 wraps it in the sandbox. */
  spawn?: (request: SpawnRequest) => AgentProcess;
  /**
   * Offers heroes Ibitsa's tools (`submit_task`) through the MCP tool bridge (#197). Without it a hero
   * can't submit, and the user marks the task done.
   */
  tools?: ToolHost;
  /** Other MCP servers for a hero's session, after the bridge. None by default. */
  mcpServers?: (session: { heroId: string; cwd: string }) => McpServer[];
}
