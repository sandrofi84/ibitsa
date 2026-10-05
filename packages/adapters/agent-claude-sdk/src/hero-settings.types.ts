import type { Options, SettingSource } from '@anthropic-ai/claude-agent-sdk';

export interface HeroSettingsInput {
  platform: NodeJS.Platform;
  settingSources: SettingSource[];
  /** The worktree's own test scripts, allowed without asking where there is no sandbox. */
  testScripts: readonly string[];
}

export type HeroSettings = Pick<
  Options,
  'permissionMode' | 'sandbox' | 'settings' | 'allowedTools' | 'settingSources'
>;
