import type { CouncillorOverrides } from './councillors.types';
import type { RuleKey, SettingValue } from './host-channel.schema';

/** One rule in the Guild Hall's Rule book (#179): its value, where it comes from, and how to edit it. */
export interface SettingView {
  key: RuleKey;
  /** From the extension's manifest. */
  description: string;
  kind: 'integer' | 'number' | 'text' | 'choice' | 'list';
  /** For a choice. */
  choices?: string[];
  /** "None" is a value of its own, e.g. no cap. */
  nullable: boolean;
  minimum?: number;
  /** What applies now, and the layer it comes from (§8.1). */
  value: SettingValue;
  layer: 'default' | 'user' | 'workspace';
  defaultValue: SettingValue;
  user?: SettingValue;
  workspace?: SettingValue;
}

/** An asset pack in the Guild Hall's Packs tab (§9.3, #183). */
export interface PackView {
  /** `default`, `user:<folder>` or `project:<folder>`. */
  id: string;
  name: string;
  scope: 'builtin' | 'user' | 'project';
  /** The validator's errors; a pack with any can't be used. */
  errors: string[];
  /** A character's walk, for the live preview; null when the pack has none to show. */
  preview: {
    sheet: string;
    frameWidth: number;
    frameHeight: number;
    row: number;
    frames: number;
    fps: number;
  } | null;
}

/** Extension → webview messages that are not core messages (#37). */
export type HostEvent =
  /** Whether a hero can start: credentials found, or development mode (spec §11.6). */
  | { channel: 'host'; type: 'credentials'; ready: boolean }
  | { channel: 'host'; type: 'apiKeyAccepted' }
  | { channel: 'host'; type: 'apiKeyRejected'; reason: string }
  /** "Ibitsa: New Quest" from the Command Palette. */
  | { channel: 'host'; type: 'openNewQuest' }
  /** "Ibitsa: Message Hero…" from the Command Palette (#87). */
  | { channel: 'host'; type: 'focusCommandBar' }
  /** "Ibitsa: Run Action…": the chosen action, ready in the bar with its preview (#87). */
  | { channel: 'host'; type: 'fillCommandBar'; text: string }
  /** The Rule book's rules (#179), after `readSettings` or a write. */
  | { channel: 'host'; type: 'settings'; rules: SettingView[] }
  /** The packs found, and the one in use (#183). */
  | { channel: 'host'; type: 'packs'; packs: PackView[]; active: string }
  /** Load this pack's files now (#183); null is the bundled default. Ends in `/`. */
  | { channel: 'host'; type: 'packChanged'; base: string | null }
  /** The Roster's settings (#181), after `readCouncilSettings` or a change. */
  | { channel: 'host'; type: 'councilSettings'; council: CouncilSettingsView };

/**
 * The Roster's settings (#181): who's turned off (`ibitsa.council.disabled`) and each councillor's
 * overrides (`ibitsa.councillors`), with the layer each comes from (§8.1).
 */
export interface CouncilSettingsView {
  disabled: string[];
  disabledLayer: 'default' | 'user' | 'workspace';
  overrides: CouncillorOverrides;
  overridesLayer: 'default' | 'user' | 'workspace';
}
