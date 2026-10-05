// The event log codec lives in core (it describes a log of core inputs); re-exported for replay users.
export {
  type EventLog,
  LOG_VERSION,
  LogFormatError,
  type LogHeader,
  type LogRecord,
  parseLog,
  serializeLine,
} from '@ibitsa/core';
