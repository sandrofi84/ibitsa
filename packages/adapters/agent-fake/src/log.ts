// The event log codec lives in core (it describes a log of core inputs); re-exported for replay users.
export type { EventLog, LogHeader, LogRecord } from '@ibitsa/core';
export { LOG_VERSION, LogFormatError, parseLog, serializeLine } from '@ibitsa/core';
