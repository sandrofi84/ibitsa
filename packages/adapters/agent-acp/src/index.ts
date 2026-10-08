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
