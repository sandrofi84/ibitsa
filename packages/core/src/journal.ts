import type { ActivityKind, JournalEntry, JournalEntryBody } from '@ibitsa/protocol';
import type { LogRecord } from './event-log.types';
import { describePermission } from './needs-you';
import type { CoreState, PendingItem } from './state.types';

/** Journal lines per page when a front end doesn't say. */
export const JOURNAL_PAGE = 100;

/**
 * A campaign's journal (#58): one line per thing worth reading back, built from the log as it is
 * written, never stored separately. Each logged input, together with the state after core stepped on it,
 * yields its lines: a tool's start and finish become one line, new "Needs you" items become asks.
 */
export class Journal {
  readonly entries: JournalEntry[] = [];
  private readonly running = new Map<string, { activity: ActivityKind; detail?: string }>();
  private readonly items = new Map<string, PendingItem>();

  /** Adds the lines one logged input brings; returns just those. */
  add({ record, state }: { record: LogRecord; state: CoreState }): JournalEntry[] {
    const lines = [...this.fromRecord({ record, state }), ...this.fromNewItems({ record, state })];
    this.entries.push(...lines);
    return lines;
  }

  /**
   * A page of lines ending at index `before` (default: the end), at most `limit` long (default 100),
   * with where it starts and how many lines there are in all.
   */
  page({
    before,
    limit = JOURNAL_PAGE,
  }: {
    before?: number | undefined;
    limit?: number | undefined;
  }): {
    entries: JournalEntry[];
    start: number;
    total: number;
  } {
    const total = this.entries.length;
    const end = Math.min(before ?? total, total);
    const start = Math.max(0, end - limit);
    return { entries: this.entries.slice(start, end), start, total };
  }

  private fromRecord({ record, state }: { record: LogRecord; state: CoreState }): JournalEntry[] {
    const t = record.t;
    const firstHero = state.heroes[0]?.id ?? null;
    const line = (heroId: string | null, entry: JournalEntryBody) => [
      { t, heroId, ...entry } as JournalEntry,
    ];
    if (record.kind === 'agent') {
      const e = record.event;
      const heroId = record.heroId;
      switch (e.type) {
        case 'activityStarted':
          this.running.set(
            e.toolUseId,
            e.detail === undefined ? { activity: e.kind } : { activity: e.kind, detail: e.detail },
          );
          return [];
        case 'activityFinished': {
          const started = this.running.get(e.toolUseId);
          this.running.delete(e.toolUseId);
          if (!started) return [];
          return line(heroId, { kind: 'tool', ...started, outcome: e.outcome });
        }
        case 'message':
          return line(heroId, { kind: 'said', text: e.text });
        case 'permission': {
          // No "Needs you" item for it means auto mode answered it (#63).
          const asked = state.needsYou.some(
            (i) => i.kind === 'permission' && i.requestId === e.requestId,
          );
          if (asked) return [];
          const { action, target } = describePermission(e.tool, e.input);
          return line(heroId, {
            kind: 'answered',
            text: `Auto-allowed: ${action.toLowerCase()} ${target}`,
          });
        }
        case 'taskSubmitted':
          return line(heroId, { kind: 'event', text: `Submitted: ${e.summary}` });
        default:
          return [];
      }
    }
    if (record.kind === 'command') {
      const c = record.command;
      switch (c.type) {
        case 'consultElder':
          return line(null, { kind: 'event', text: `You asked the elder: ${title(c.task)}` });
        case 'startQuest':
          return line(null, { kind: 'event', text: `Quest started: ${title(c.description)}` });
        case 'startPlannedQuest':
          return line(null, { kind: 'event', text: "The council's plan begins." });
        case 'approvePlan':
          return line(null, { kind: 'event', text: `You approved plan v${c.version}.` });
        case 'sendMessage':
          return line(c.heroId, { kind: 'you', text: c.text, priority: c.priority });
        case 'stopHero':
          return line(c.heroId, { kind: 'event', text: 'You stopped the hero.' });
        case 'resumeHero':
          return line(c.heroId, { kind: 'event', text: 'You resumed the hero.' });
        case 'restHero':
          return line(c.heroId, { kind: 'event', text: 'You let the hero rest.' });
        case 'markDone':
          return line(c.heroId, { kind: 'event', text: 'You marked the task done.' });
        case 'raiseBudget':
          return line(c.heroId, { kind: 'event', text: 'You raised the gold pouch.' });
        case 'answerPermission': {
          const item = this.items.get(c.itemId);
          const what =
            item?.kind === 'permission' ? `: ${item.action.toLowerCase()} ${item.target}` : '';
          const note = c.note ? ` (${c.note})` : '';
          const verb = c.decision === 'allow' ? 'You allowed' : 'You denied';
          return line(item?.heroId ?? firstHero, {
            kind: 'answered',
            text: `${verb}${what}${note}`,
          });
        }
        case 'answerQuestion': {
          const item = this.items.get(c.itemId);
          const answers = Object.values(c.answers)
            .map((a) => (Array.isArray(a) ? a.join(', ') : a))
            .join('; ');
          return line(item?.heroId ?? firstHero, {
            kind: 'answered',
            text: `You answered: ${answers}`,
          });
        }
        case 'finishQuest':
          return line(null, { kind: 'event', text: 'You finished the quest.' });
        case 'abandonQuest':
          return line(null, { kind: 'event', text: 'You abandoned the quest.' });
        case 'setAutoApprove':
          return line(null, {
            kind: 'event',
            text: c.on ? 'You turned auto mode on.' : 'You turned auto mode off.',
          });
        default:
          return [];
      }
    }
    if (record.kind === 'elder') {
      const e = record.event;
      if (e.type === 'briefSubmitted') {
        return line(null, { kind: 'event', text: "The elder's brief is ready." });
      }
      if (e.type === 'error') {
        return line(null, { kind: 'event', text: `The elder couldn't finish: ${e.message}` });
      }
      return [];
    }
    if (record.kind === 'gm') {
      const e = record.event;
      switch (e.type) {
        case 'worktreeCreated':
          return line(null, { kind: 'event', text: `Worktree ready on ${e.branch}.` });
        case 'worktreeFailed':
          return line(null, { kind: 'event', text: `The worktree failed: ${e.message}` });
        case 'submitChecked':
          return line(e.heroId, {
            kind: 'event',
            text: e.ok
              ? 'The submit check passed.'
              : `The submit check failed: ${e.reason ?? 'no reason given'}`,
          });
        case 'runtimeRestarted':
          return line(firstHero, { kind: 'event', text: 'VS Code reloaded; the session stopped.' });
        case 'worktreeRemoved':
          return line(null, { kind: 'event', text: 'Worktree removed.' });
        default:
          return [];
      }
    }
    return [];
  }

  /** "Needs you" items that appeared with this input: asks, stalls, errors, out of gold. */
  private fromNewItems({ record, state }: { record: LogRecord; state: CoreState }): JournalEntry[] {
    const lines: JournalEntry[] = [];
    for (const item of state.needsYou) {
      if (this.items.has(item.id)) continue;
      this.items.set(item.id, item);
      const text = itemText(item);
      if (text) lines.push({ t: record.t, heroId: item.heroId, ...text } as JournalEntry);
    }
    return lines;
  }
}

function title(description: string): string {
  return description.split('\n')[0]?.trim() ?? '';
}

function itemText(
  item: PendingItem,
): { kind: 'asked'; text: string } | { kind: 'event'; text: string } | null {
  switch (item.kind) {
    case 'permission':
      return { kind: 'asked', text: `Asks to ${item.action.toLowerCase()}: ${item.target}` };
    case 'question':
      return { kind: 'asked', text: item.questions.map((q) => q.question).join(' ') };
    case 'stalled':
      return { kind: 'event', text: `Stalled: ${item.reason}` };
    case 'outOfGold':
      return { kind: 'event', text: 'Out of gold.' };
    case 'error':
      return { kind: 'event', text: `Error: ${item.message}` };
    case 'reply':
      return null;
  }
}
