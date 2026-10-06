import type { CommandHistoryOptions } from './command-history.types';

/**
 * What you sent from the command bar (#81), recalled with ↑ and ↓ like a shell: ↑ steps back through
 * earlier messages, ↓ forward, and stepping past the newest brings back what you were typing.
 */
export class CommandHistory {
  private entries: string[];
  private readonly limit: number;
  private cursor: number;
  private draft = '';

  constructor({ entries = [], limit = 50 }: CommandHistoryOptions = {}) {
    this.limit = limit;
    this.entries = entries.slice(-limit);
    this.cursor = this.entries.length;
  }

  get all(): string[] {
    return [...this.entries];
  }

  /** Remembers a sent message (not twice in a row) and starts browsing from the newest again. */
  add(text: string): void {
    const trimmed = text.trim();
    if (trimmed && this.entries.at(-1) !== trimmed) {
      this.entries = [...this.entries, trimmed].slice(-this.limit);
    }
    this.cursor = this.entries.length;
    this.draft = '';
  }

  /** The message before the one shown; `current` is kept as the draft when leaving it. Null at the oldest. */
  previous(current: string): string | null {
    if (this.cursor === 0) return null;
    if (this.cursor === this.entries.length) this.draft = current;
    this.cursor -= 1;
    return this.entries[this.cursor] ?? null;
  }

  /** The message after the one shown, then the draft. Null when already on the draft. */
  next(): string | null {
    if (this.cursor >= this.entries.length) return null;
    this.cursor += 1;
    return this.cursor === this.entries.length ? this.draft : (this.entries[this.cursor] ?? null);
  }
}
