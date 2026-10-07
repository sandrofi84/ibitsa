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
  | { channel: 'host'; type: 'settings'; rules: SettingView[] };
