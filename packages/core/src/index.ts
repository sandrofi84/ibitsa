// Pure game master: step(state, input) → { state, cues, effects }. No Node or vscode imports (ADR 0001).
export type { CampaignRecordData } from './campaign-record.types';
export type { Effect } from './effects.types';
export { Elder } from './elder';
export { LOG_VERSION, LogFormatError, parseLog, serializeLine } from './event-log';
export type { EventLog, LogHeader, LogRecord } from './event-log.types';
export { CONTINUE_PROMPT, Hero, RESTART_PROMPT, SILENCE_MS } from './hero';
export type { CoreInput, GameMasterEvent } from './inputs.types';
export { JOURNAL_PAGE, Journal } from './journal';
export { describePermission } from './needs-you';
export { Quest } from './quest';
export { Review } from './review';
export { Sitting } from './sitting';
export { DEFAULT_SETTINGS, initialState } from './state';
export type {
  CoreState,
  ElderRecord,
  HeroRecord,
  QuestSettings,
  SittingRecord,
} from './state.types';
export { step } from './step';
export type { StepResult } from './step.types';
export { view } from './view';
