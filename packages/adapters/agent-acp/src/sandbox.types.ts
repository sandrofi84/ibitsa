import type { SpawnRequest } from './acp-adapter.types';

/** What an agent needs from the sandbox besides the worktree (§11.5): from its `ibitsa.agents` entry. */
export interface SandboxProfile {
  /** Folders it keeps its state in (absolute), which it may write. */
  stateFolders: string[];
  /** Domains it reaches without asking, e.g. its API; any other asks through "Needs you". */
  domains: string[];
  /** macOS: reopen the system's certificate service for native TLS (Codex, #195). */
  weakerNetworkIsolation?: boolean;
}

/** A new domain an agent wants to reach under the sandbox (#200); answered by "Needs you". */
export interface NetworkRequest {
  host: string;
  port: number | null;
}

export interface AgentSandboxOptions {
  /** The sandbox host script (the extension's `dist/sandbox-host.cjs`). */
  script: string;
  /**
   * The Node that runs it. By default the runtime's own executable with `ELECTRON_RUN_AS_NODE=1`: in
   * VS Code that is the Electron binary, which then behaves as plain Node.
   */
  node?: { command: string; env?: Record<string, string> };
  /** The MCP tool bridge's socket (#197), which agents inside must reach. */
  bridgeSocket?: string;
  /** Defaults to the real ones; injectable for tests. */
  platform?: NodeJS.Platform;
  home?: string;
  tmp?: string;
}

/** Starting one agent under the sandbox: the adapter's request and the agent's profile. */
export interface SandboxSpawn {
  request: SpawnRequest;
  profile: SandboxProfile;
}

/** Everything that decides one hero's sandbox config. */
export interface SandboxConfigInput {
  cwd: string;
  profile: SandboxProfile;
  platform: NodeJS.Platform;
  home: string;
  tmp: string;
  /** The main repository's `.git`, which a worktree's git commands write to; null outside a worktree. */
  sharedGit: string | null;
  bridgeSocket?: string;
}
