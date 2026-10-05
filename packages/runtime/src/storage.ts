import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  type EventLog,
  LOG_VERSION,
  type LogHeader,
  type LogRecord,
  parseLog,
  serializeLine,
} from '@ibitsa/core';
import { PROTOCOL_VERSION } from '@ibitsa/protocol';

/** Past this size, new records lose their activity `detail` text; nothing that affects state is dropped. */
export const LOG_SIZE_CAP = 20 * 1024 * 1024;

/**
 * Campaign logs under `<storage>/campaigns/<id>/events.jsonl` (spec §12), with an `active` pointer to the
 * campaign that is still running. The log is the only persisted record (ADR 0001).
 */
export class CampaignStore {
  constructor(private readonly storageDir: string) {}

  private get root(): string {
    return join(this.storageDir, 'campaigns');
  }

  private logPath(id: string): string {
    return join(this.root, id, 'events.jsonl');
  }

  activeId(): string | null {
    const pointer = join(this.root, 'active');
    if (!existsSync(pointer)) return null;
    const id = readFileSync(pointer, 'utf8').trim();
    return id && existsSync(this.logPath(id)) ? id : null;
  }

  /** The running campaign, else the one whose log changed last: what "Export Replay" exports. */
  latestId(): string | null {
    const active = this.activeId();
    if (active) return active;
    if (!existsSync(this.root)) return null;
    const logs = readdirSync(this.root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(this.logPath(d.name)))
      .map((d) => ({ id: d.name, modified: statSync(this.logPath(d.name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    return logs[0]?.id ?? null;
  }

  read(id: string): EventLog {
    return parseLog(readFileSync(this.logPath(id), 'utf8'));
  }

  create(id: string, startedAt: Date): CampaignLog {
    mkdirSync(join(this.root, id), { recursive: true });
    const header: LogHeader = {
      kind: 'header',
      logVersion: LOG_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      campaignId: id,
      startedAt: startedAt.toISOString(),
    };
    writeFileSync(this.logPath(id), serializeLine(header));
    writeFileSync(join(this.root, 'active'), id);
    return new CampaignLog(this.logPath(id), header);
  }

  open(id: string, header: LogHeader): CampaignLog {
    return new CampaignLog(this.logPath(id), header);
  }

  clearActive(): void {
    rmSync(join(this.root, 'active'), { force: true });
  }
}

export class CampaignLog {
  readonly startedAtMs: number;

  constructor(
    readonly path: string,
    readonly header: LogHeader,
  ) {
    this.startedAtMs = Date.parse(header.startedAt);
  }

  /** Synchronous append: the input is on disk before core steps on it. */
  append(record: LogRecord): void {
    const oversize = existsSync(this.path) && statSync(this.path).size > LOG_SIZE_CAP;
    appendFileSync(this.path, serializeLine(oversize ? withoutDetail(record) : record));
  }
}

function withoutDetail(record: LogRecord): LogRecord {
  if (record.kind !== 'agent' || record.event.type !== 'activityStarted') return record;
  const { detail: _detail, ...event } = record.event;
  return { ...record, event };
}
