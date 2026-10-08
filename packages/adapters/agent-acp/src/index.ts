// Generic Agent Client Protocol adapter (spec §11.5).

export { AcpAdapter, COMMANDS_WAIT_MS } from './acp-adapter';
export type {
  AcpAdapterOptions,
  AgentPrices,
  AgentProcess,
  AgentSpec,
  SpawnRequest,
} from './acp-adapter.types';
export { CANT_RESUME } from './acp-session';
export { spawnAgent } from './agent-connection';
export { ESTIMATE_BASIS } from './gold';
export { HERO_TOOL_INSTRUCTIONS, SUBMIT_TASK } from './hero-tools';
export { runMcpBridge } from './mcp-bridge';
export { ToolBridge } from './tool-bridge';
export type { BridgeTool } from './tool-bridge.schema';
export type {
  McpBridgeIo,
  OpenTools,
  ToolBridgeOptions,
  ToolHost,
  ToolResult,
  ToolSet,
} from './tool-bridge.types';
