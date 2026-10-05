// Replays recorded event logs as core inputs (spec §12, §13). Platform-neutral.
export {
  type EventLog,
  LOG_VERSION,
  LogFormatError,
  type LogHeader,
  type LogRecord,
  parseLog,
  serializeLine,
} from './log';
export { DEFAULT_OPTIONS, Replay } from './replay';
export type { Clock, ReplayCallbacks, ReplayOptions, ReplayStatus } from './replay.types';
export { replayThroughCore } from './run';
export type { ReplayOutput } from './run.types';
