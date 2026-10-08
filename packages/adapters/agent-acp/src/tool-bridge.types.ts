import type { McpServerStdio } from '@agentclientprotocol/sdk';
import type { BridgeTool } from './tool-bridge.schema.ts';

/** A tool call's answer, as the text the agent reads; `isError` marks it as a failed call. */
export interface ToolResult {
  text: string;
  isError?: boolean;
}

/** One session's tools: what the bridge offers, and who answers a call. */
export interface ToolSet {
  tools: BridgeTool[];
  call: (call: { name: string; arguments: unknown }) => Promise<ToolResult>;
}

/** A session's tools, open on the bridge: the MCP server to list in `session/new`, until `close`. */
export interface OpenTools {
  server: McpServerStdio;
  close(): void;
}

/** Offers tools to agent sessions (#197); the adapter takes any, tests a stand-in. */
export interface ToolHost {
  open(tools: ToolSet): Promise<OpenTools>;
}

export interface ToolBridgeOptions {
  /** The bridge's MCP server script (the extension's `dist/mcp-bridge.cjs`). */
  script: string;
  /**
   * The Node that runs it. By default the runtime's own executable with `ELECTRON_RUN_AS_NODE=1`: in
   * VS Code that is the Electron binary, which then behaves as plain Node; plain Node ignores it.
   */
  node?: { command: string; env?: Record<string, string> };
  /** Where the socket goes; the system's temp folder by default. Not on Windows (a named pipe). */
  socketDir?: string;
}

/** The streams and environment the MCP bridge process runs with. */
export interface McpBridgeIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** `IBITSA_BRIDGE` (the socket) and `IBITSA_BRIDGE_TOKEN` (the session's secret). */
  env: Record<string, string | undefined>;
}
