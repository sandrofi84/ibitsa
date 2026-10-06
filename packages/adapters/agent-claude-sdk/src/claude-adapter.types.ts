import type {
  createSdkMcpServer,
  query,
  SettingSource,
  tool,
} from '@anthropic-ai/claude-agent-sdk';

/** The parts of the SDK the adapter uses; injectable so tests run without the SDK or tokens. */
export interface SdkModule {
  query: typeof query;
  createSdkMcpServer: typeof createSdkMcpServer;
  tool: typeof tool;
}

export interface ClaudeAdapterOptions {
  /** Environment for the agent process, including the user's credentials (spec §11.6). */
  env: () => Record<string, string | undefined>;
  /** `ibitsa.claudeCodePath`; empty or undefined uses the binary bundled with the SDK. */
  claudeCodePath?: () => string | undefined;
  loadSdk?: () => Promise<SdkModule>;
  /** `ibitsa.hero.settingSources`; defaults to `['project']` (spec §11.6). */
  settingSources?: () => SettingSource[];
  /** Local plugin folders every session loads, e.g. Ibitsa's built-in actions (#84). */
  pluginDirs?: () => string[];
  /** The user's home, for personal skills; injectable for tests. */
  home?: string;
  /** Injectable for tests; defaults to the real platform and a PATH lookup. */
  platform?: NodeJS.Platform;
  hasCommand?: (name: string) => boolean;
}
