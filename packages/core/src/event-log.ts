import { PROTOCOL_VERSION, parseCommand } from '@ibitsa/protocol';
import type { CoreInput } from './inputs';

/** Event log format version (spec §12). Bump on incompatible changes; older logs are migrated or rejected. */
export const LOG_VERSION = 1;

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

export class LogFormatError extends Error {}

const KINDS = new Set(['agent', 'command', 'gm', 'timer']);

export function parseLog(text: string): EventLog {
  const lines = text.split('\n');
  while (lines.length > 0 && lines.at(-1)?.trim() === '') lines.pop();
  const parsed: unknown[] = [];
  let tornTail = false;
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      parsed.push(JSON.parse(line));
    } catch {
      if (i === lines.length - 1 && i > 0) tornTail = true;
      else throw new LogFormatError(`line ${i + 1}: not valid JSON`);
    }
  });

  const header = parsed.shift() as Partial<LogHeader> | undefined;
  if (header?.kind !== 'header') throw new LogFormatError('line 1: missing header');
  if (header.logVersion !== LOG_VERSION) {
    throw new LogFormatError(`unsupported logVersion ${String(header.logVersion)}`);
  }
  if (typeof header.campaignId !== 'string' || typeof header.startedAt !== 'string') {
    throw new LogFormatError('line 1: header needs campaignId and startedAt');
  }
  if (header.protocolVersion !== PROTOCOL_VERSION) {
    throw new LogFormatError(`unsupported protocolVersion ${String(header.protocolVersion)}`);
  }

  let lastT = 0;
  const records = parsed.map((value, i) => {
    const line = i + 2;
    const record = value as Partial<LogRecord>;
    if (typeof record.kind !== 'string' || !KINDS.has(record.kind)) {
      throw new LogFormatError(`line ${line}: unknown record kind`);
    }
    if (typeof record.t !== 'number' || record.t < lastT) {
      throw new LogFormatError(`line ${line}: t must be a number that never decreases`);
    }
    lastT = record.t;
    if (record.kind === 'command') {
      const result = parseCommand(record.command);
      if (!result.ok) throw new LogFormatError(`line ${line}: ${result.issues.join('; ')}`);
    }
    return record as LogRecord;
  });

  return { header: header as LogHeader, records, tornTail };
}

export function serializeLine(entry: LogHeader | LogRecord): string {
  return `${JSON.stringify(entry)}\n`;
}
