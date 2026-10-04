// Pure game master: step(state, input) → { state, cues, effects }. No Node or vscode imports (ADR 0001).
export type { Effect } from './effects';
export {
  type EventLog,
  LOG_VERSION,
  LogFormatError,
  type LogHeader,
  type LogRecord,
  parseLog,
  serializeLine,
} from './event-log';
export type { CoreInput, GameMasterEvent } from './inputs';
export { describePermission } from './permissions';
export { type CoreState, initialState } from './state';
export { SILENCE_MS, type StepResult, step } from './step';
export { deriveState, sumGold, view } from './view';
