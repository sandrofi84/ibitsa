import type { Options, PermissionUpdate, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import type { Worktree } from './worktree';

export interface HeroSettingsInput {
  platform: NodeJS.Platform;
  settingSources: SettingSource[];
  /** The worktree's own test scripts, allowed without asking where there is no sandbox. */
  testScripts: readonly string[];
  /** "Always allow" rules for this session (#62), e.g. `Bash(npm run lint:*)`. */
  allowRules: readonly string[];
}

/** A permission request as `canUseTool` gets it, for deciding what "Always allow" may offer. */
export interface PermissionRequest {
  toolName: string;
  input: Record<string, unknown>;
  worktree: Worktree;
  suggestions?: PermissionUpdate[] | undefined;
  blockedPath?: string | undefined;
}

/** What "Always allow" offers for one request: rule texts to show, updates to send back. */
export interface OfferedRules {
  rules: string[];
  updates: PermissionUpdate[];
}

export type HeroSettings = Pick<
  Options,
  'permissionMode' | 'sandbox' | 'settings' | 'allowedTools' | 'settingSources'
>;
