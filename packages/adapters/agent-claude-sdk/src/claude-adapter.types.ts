import type { query } from '@anthropic-ai/claude-agent-sdk';

export type QueryFunction = typeof query;

export interface ClaudeAdapterOptions {
  /** Environment for the agent process, including the user's credentials (spec §11.6). */
  env: () => Record<string, string | undefined>;
  /** `ibitsa.claudeCodePath`; empty or undefined uses the binary bundled with the SDK. */
  claudeCodePath?: () => string | undefined;
  /** Loads the SDK's `query`; injectable so tests run without the SDK or tokens. */
  loadQuery?: () => Promise<QueryFunction>;
}
