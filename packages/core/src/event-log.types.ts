import type { CoreInput } from './inputs.types';

export interface LogHeader {
  kind: 'header';
  logVersion: number;
  protocolVersion: number;
  campaignId: string;
  /** ISO timestamp; every record's `t` is milliseconds since this moment. */
  startedAt: string;
}

/** One logged core input. `mark` names a point where fixture tests capture a snapshot. */
export type LogRecord = CoreInput & { mark?: string };

export interface EventLog {
  header: LogHeader;
  records: LogRecord[];
  /** True when a torn last line (a crash mid-write) was skipped. */
  tornTail: boolean;
}
