import { realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { type EventLog, type LogRecord, serializeLine } from '@ibitsa/core';
import type { ReplayExportOptions } from './replay-export.types';

export const BLANKED = '[message removed]';

/**
 * "Ibitsa: Export Replay" (spec §12): a campaign log made fit to share as an agent-fake fixture. Paths
 * become relative to the hero's worktree and, optionally, message text is blanked. Every record stays,
 * so the copy replays to the same state as the original.
 */
export class ReplayExport {
  constructor(private readonly options: ReplayExportOptions) {}

  apply(log: EventLog): string {
    const rewrite = this.pathRewriter(log);
    const lines = [serializeLine(log.header)];
    for (const record of log.records) {
      const shown = this.options.blankMessages ? blank(record) : record;
      lines.push(serializeLine(mapStrings(shown, rewrite) as LogRecord));
    }
    return lines.join('');
  }

  /** The same path rewriting for anything else from that campaign, e.g. a live snapshot to compare. */
  relativize<T>(log: EventLog, value: T): T {
    return mapStrings(value, this.pathRewriter(log)) as T;
  }

  /** Longest prefixes first, so a worktree inside the home folder becomes `.`, not `~/…`. */
  private pathRewriter(log: EventLog): (text: string) => string {
    const worktree = log.records.find((r) => r.kind === 'gm' && r.event.type === 'worktreeCreated');
    const worktreePath =
      worktree?.kind === 'gm' && worktree.event.type === 'worktreeCreated'
        ? worktree.event.path
        : null;
    const bases: [string, string][] = [];
    if (worktreePath) {
      bases.push([worktreePath, '.']);
      bases.push([this.options.repoDir, relative(worktreePath, this.options.repoDir) || '.']);
    }
    bases.push([this.options.homeDir, '~']);
    const rules = bases
      .flatMap(([base, to]) => spellings(base).map((spelling) => ({ spelling, to })))
      .sort((a, b) => b.spelling.length - a.spelling.length)
      .map(({ spelling, to }) => {
        const p = escapeRegExp(spelling);
        return {
          // `base/x` → `to/x` (or plain `x` for the worktree itself); a bare `base` → `to`.
          inside: new RegExp(`${p}[\\\\/]`, 'g'),
          bare: new RegExp(`${p}(?![\\w.-])`, 'g'),
          to,
        };
      });
    return (text) =>
      rules.reduce(
        (s, r) => s.replace(r.inside, r.to === '.' ? '' : `${r.to}/`).replace(r.bare, r.to),
        text,
      );
  }
}

/** A path as the agent may have written it: as given, resolved through symlinks, macOS's /private. */
function spellings(path: string): string[] {
  const all = new Set([path]);
  try {
    all.add(realpathSync(path));
  } catch {
    // Gone already (a removed worktree): the other spellings still apply.
  }
  for (const p of [...all]) {
    if (/^\/(var|tmp)\//.test(p)) all.add(`/private${p}`);
    if (/^\/private\/(var|tmp)\//.test(p)) all.add(p.slice('/private'.length));
  }
  return [...all].filter((p) => p.length > 1);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  }
  return value;
}

/** What the user and the hero said, replaced; the quest's first line stays as its title. */
function blank(record: LogRecord): LogRecord {
  if (record.kind === 'agent') {
    const e = record.event;
    if (e.type === 'message') return { ...record, event: { ...e, text: BLANKED } };
    if (e.type === 'taskSubmitted') return { ...record, event: { ...e, summary: BLANKED } };
    return record;
  }
  if (record.kind === 'command') {
    const c = record.command;
    if (c.type === 'startQuest') {
      return { ...record, command: { ...c, description: c.description.split('\n')[0] ?? '' } };
    }
    if (c.type === 'sendMessage') return { ...record, command: { ...c, text: BLANKED } };
    if (c.type === 'answerPermission' && c.note !== undefined) {
      return { ...record, command: { ...c, note: BLANKED } };
    }
  }
  return record;
}
