import type { AgentCheck, AgentView } from './agents.types';
import type { Recolor } from './classes.schema';
import type { HeroClassView } from './classes.types';
import type { CouncillorOverrides } from './councillors.types';
import type { SettingKey, SettingValue } from './host-channel.schema';

/** One rule in the Guild Hall's Rule book (#179): its value, where it comes from, and how to edit it. */
export interface SettingView {
  key: SettingKey;
  /** From the extension's manifest. */
  description: string;
  kind: 'integer' | 'number' | 'text' | 'choice' | 'list' | 'toggle';
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
  /** The validator's warnings (#235), e.g. tiles no longer used: shown, but the pack can still be used. */
  warnings: string[];
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
  | { channel: 'host'; type: 'councilSettings'; council: CouncilSettingsView }
  /** The Armory (#182), after `readArmory` or a write. */
  | { channel: 'host'; type: 'armory'; armory: ArmoryView }
  /** One agent's party check (§11.5, #199), after `checkAgents`. */
  | { channel: 'host'; type: 'agentCheck'; check: AgentCheck };

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

/** Where a class's or a recolor's setting comes from (§8.1): none set means the built-in. */
export type ArmoryLayer = 'default' | 'user' | 'workspace';

/** The Guild Hall's Armory (#182): the classes and recolors in play, each with its layer. */
export interface ArmoryView {
  classes: (HeroClassView & { layer: ArmoryLayer })[];
  recolor: { target: string; recolor: Recolor; layer: ArmoryLayer }[];
  /** The agents a class can run on besides Claude (§11.5, #198), and whether each is installed. */
  agents: AgentView[];
}
