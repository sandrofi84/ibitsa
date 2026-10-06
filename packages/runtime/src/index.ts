// Carries out core effects (git, adapters, timers), writes the event log, rebuilds state on start
// (spec §11.2, §12; ADR 0001). Node, no vscode imports.

export { councilVersion } from './council';
export type { CouncilVersionInput } from './council.types';
export { GitGameMaster } from './git-game-master';
export type { GitGameMasterOptions } from './git-game-master.types';
export type {
  AgentAdapter,
  AgentSession,
  Clock,
  CreateActionRequest,
  CreateActionResult,
  FrontEnd,
  GameMaster,
  SessionResume,
  SessionStart,
  UserSettings,
} from './ports.types';
export { BLANKED, ReplayExport } from './replay-export';
export type { ReplayExportOptions } from './replay-export.types';
export { Runtime, SNAPSHOT_INTERVAL_MS } from './runtime';
export type { Connection, RuntimeOptions } from './runtime.types';
export type { FolderWatcher } from './skill-catalog.types';
export { CampaignLog, CampaignStore, LOG_SIZE_CAP } from './storage';
export { systemClock } from './system-clock';
