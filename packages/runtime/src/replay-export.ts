import { realpathSync } from 'node:fs';
import { relative } from 'node:path';
import { type EventLog, type LogRecord, serializeLine } from '@ibitsa/core';
import type { CouncilEvent } from '@ibitsa/protocol';
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
      // `/` whatever the OS, so a fixture reads the same wherever it was recorded.
      const repo = relative(worktreePath, this.options.repoDir).replaceAll('\\', '/');
      bases.push([this.options.repoDir, repo || '.']);
    }
    bases.push([this.options.homeDir, '~']);
    // Windows paths match whatever their case: C:\Wt and c:\wt are the same folder (#56).
    const flags = (this.options.platform ?? process.platform) === 'win32' ? 'gi' : 'g';
    const rules = bases
      .flatMap(([base, to]) => spellings(base).map((spelling) => ({ spelling, to })))
      .sort((a, b) => b.spelling.length - a.spelling.length)
      .map(({ spelling, to }) => {
        const p = escapeRegExp(spelling);
        return {
          // `base/rest` → `to/rest` (plain `rest` for the worktree itself), the rest written with `/`
          // (#56); a bare `base` → `to`.
          inside: new RegExp(`${p}[\\\\/]([^\\s"'\`<>|]*)`, flags),
          bare: new RegExp(`${p}(?![\\w.-])`, flags),
          to,
        };
      });
    return (text) =>
      rules.reduce(
        (s, r) =>
          s
            .replace(r.inside, (_match, rest: string) => {
              const tail = rest.replaceAll('\\', '/');
              return r.to === '.' ? tail : `${r.to}/${tail}`;
            })
            .replace(r.bare, r.to),
        text,
      );
  }
}

/**
 * A path as the agent may have written it: as given, resolved through symlinks, macOS's /private, and
 * on Windows with either separator.
 */
function spellings(path: string): string[] {
  const all = new Set([path, path.replaceAll('\\', '/')]);
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

/**
 * What the user, the hero, the elder and the council said, replaced; a task's first line stays as its
 * title. Ids, councillors, options' ids and file paths stay, so the copy replays the same way.
 */
function blank(record: LogRecord): LogRecord {
  if (record.kind === 'elder' && record.event.type === 'briefSubmitted') {
    const { brief } = record.event;
    return {
      ...record,
      event: {
        ...record.event,
        brief: {
          ...brief,
          task: BLANKED,
          findings: brief.findings.map(() => BLANKED),
          slices: brief.slices.map((slice) => ({ ...slice, summary: BLANKED })),
        },
      },
    };
  }
  if (record.kind === 'council') return { ...record, event: blankCouncil(record.event) };
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
    if (c.type === 'consultElder' || c.type === 'conveneCouncil') {
      return { ...record, command: { ...c, task: c.task.split('\n')[0] ?? '' } };
    }
    if (c.type === 'sendMessage' || c.type === 'requestPlanChange') {
      return { ...record, command: { ...c, text: BLANKED } };
    }
    if (c.type === 'askCouncilWhy' && c.text !== undefined) {
      return { ...record, command: { ...c, text: BLANKED } };
    }
    if (c.type === 'answerCouncil') {
      const answers = Object.fromEntries(
        Object.entries(c.answers).map(([id, a]) => [id, 'text' in a ? { text: BLANKED } : a]),
      );
      return { ...record, command: { ...c, answers } };
    }
    if (c.type === 'answerPermission' && c.note !== undefined) {
      return { ...record, command: { ...c, note: BLANKED } };
    }
  }
  return record;
}

function blankCouncil(event: CouncilEvent): CouncilEvent {
  const all = (items: string[]) => items.map(() => BLANKED);
  switch (event.type) {
    case 'reportFiled': {
      const { report } = event;
      return {
        ...event,
        report: {
          concerns: report.concerns.map((c) => ({ ...c, summary: BLANKED, reason: BLANKED })),
          questions: all(report.questions),
          recommendations: all(report.recommendations),
          notChecked: all(report.notChecked),
          ...(report.bowOut === undefined ? {} : { bowOut: BLANKED }),
        },
      };
    }
    case 'questionsAsked':
      return {
        ...event,
        questions: event.questions.map((q) => ({
          ...q,
          question: BLANKED,
          options: q.options.map((o) => ({ ...o, label: BLANKED, tradeoff: BLANKED })),
          ...(q.recommendation ? { recommendation: { ...q.recommendation, reason: BLANKED } } : {}),
        })),
      };
    case 'planProposed': {
      // Words go; ids, files, councillors and the order stay, so the blanked plan still checks out.
      const { plan } = event;
      return {
        ...event,
        plan: {
          ...plan,
          summary: BLANKED,
          goal: BLANKED,
          ...(plan.scope === undefined ? {} : { scope: BLANKED }),
          tasks: plan.tasks.map((t) => ({
            ...t,
            title: BLANKED,
            description: BLANKED,
            criteria: t.criteria.map((c) => ({ ...c, items: c.items.map(() => BLANKED) })),
          })),
          decisions: plan.decisions.map((d) => ({
            ...d,
            title: BLANKED,
            chosen: BLANKED,
            why: BLANKED,
            alternatives: d.alternatives.map(() => ({ option: BLANKED, rejectedBecause: BLANKED })),
            ...(d.tradeoffs === undefined ? {} : { tradeoffs: BLANKED }),
            ...(d.discussion === undefined ? {} : { discussion: BLANKED }),
          })),
        },
      };
    }
    case 'said':
      return { ...event, text: BLANKED };
    default:
      return event;
  }
}
