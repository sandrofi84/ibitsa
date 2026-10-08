import type { AgentDefinition } from '@ibitsa/protocol';

export interface HeroAgentsDeps {
  /** `ibitsa.agents` over the presets, read each time (§11.5). */
  agents: () => AgentDefinition[];
  /** The environment heroes start from (§11.6, #67): a fresh login shell's once the runtime has one. */
  env: () => Record<string, string | undefined>;
  /** Defaults to the real one; on Windows npm's `.cmd` shims need a shell to start. */
  platform?: NodeJS.Platform;
}

/** Finding a command the way a shell would (§11.5, #198). */
export interface CommandLookup {
  command: string;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  /** Injectable for tests; defaults to the file system. */
  isFile?: (path: string) => boolean;
  home?: string;
}
