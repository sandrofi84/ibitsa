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
export {
  type Clock,
  DEFAULT_OPTIONS,
  Replay,
  type ReplayCallbacks,
  type ReplayOptions,
  type ReplayStatus,
} from './replay';
export { type ReplayOutput, replayThroughCore } from './run';
