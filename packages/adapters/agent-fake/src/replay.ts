import type { Command } from '@ibitsa/protocol';
import type { EventLog, LogRecord } from './log';
import type { Clock, ReplayCallbacks, ReplayOptions, ReplayStatus } from './replay.types';

export const DEFAULT_OPTIONS: ReplayOptions = {
  speed: 1,
  gapCapMs: 3_000,
  loop: false,
  mode: 'auto',
  interactiveTypes: null,
};

// Timers exist in browsers and Node alike; declared here because this package uses neither lib.
declare function setTimeout(fn: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

const defaultClock: Clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout };

/** Plays an event log into a core (spec §13). Platform-neutral: runs in the browser and in tests. */
export class Replay {
  private position = 0;
  private playing = false;
  private waitingFor: Command['type'] | null = null;
  private diverged = false;
  private timer: unknown = null;
  private opts: ReplayOptions;

  private readonly log: EventLog;
  private readonly callbacks: ReplayCallbacks;
  private readonly clock: Clock;

  constructor({
    log,
    callbacks,
    options = {},
    clock = defaultClock,
  }: {
    log: EventLog;
    callbacks: ReplayCallbacks;
    options?: Partial<ReplayOptions>;
    clock?: Clock;
  }) {
    this.log = log;
    this.callbacks = callbacks;
    this.clock = clock;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
  }

  get options(): Readonly<ReplayOptions> {
    return this.opts;
  }

  get status(): ReplayStatus {
    return {
      position: this.position,
      total: this.log.records.length,
      playing: this.playing,
      finished: this.position >= this.log.records.length,
      waitingFor: this.waitingFor,
      diverged: this.diverged,
    };
  }

  setOptions(options: Partial<ReplayOptions>): void {
    this.opts = { ...this.opts, ...options };
    if (this.playing) this.schedule();
  }

  play(): void {
    this.playing = true;
    this.schedule();
    this.emit();
  }

  pause(): void {
    this.playing = false;
    this.cancel();
    this.emit();
  }

  /** Advance exactly one record (when paused). */
  step(): void {
    if (this.waitingFor) return;
    this.advance();
    this.emit();
  }

  /**
   * A command sent from the game during replay. Accepted only in interactive mode while waiting for a
   * command of the same type; it is fed instead of the recorded one. Returns false when rejected.
   */
  submitLive(command: Command): boolean {
    const record = this.log.records[this.position];
    if (this.opts.mode !== 'interactive' || !this.waitingFor || record?.kind !== 'command') {
      return false;
    }
    if (command.type !== record.command.type) return false;
    if (!sameIgnoringCommandId(command, record.command)) this.diverged = true;
    this.waitingFor = null;
    this.position++;
    this.callbacks.feed({ kind: 'command', t: record.t, command });
    this.afterFeed();
    if (this.playing) this.schedule();
    this.emit();
    return true;
  }

  private advance(): void {
    const record = this.log.records[this.position];
    if (!record) return;
    if (this.waitsFor(record)) {
      this.waitingFor = record.command.type;
      return;
    }
    this.position++;
    this.callbacks.feed(record);
    this.afterFeed();
  }

  private waitsFor(record: LogRecord): record is Extract<LogRecord, { kind: 'command' }> {
    if (this.opts.mode !== 'interactive' || record.kind !== 'command') return false;
    const type = record.command.type;
    return type !== 'hello' && (this.opts.interactiveTypes?.includes(type) ?? true);
  }

  private afterFeed(): void {
    if (this.position < this.log.records.length || !this.opts.loop) return;
    this.position = 0;
    this.diverged = false;
    this.callbacks.restart?.();
  }

  private schedule(): void {
    this.cancel();
    if (!this.playing || this.waitingFor) return;
    if (this.position >= this.log.records.length) {
      this.playing = false;
      return;
    }
    if (this.opts.speed === 'instant') {
      // Bounded so `instant` + `loop` cannot spin forever.
      let budget = this.log.records.length;
      while (
        this.playing &&
        !this.waitingFor &&
        budget-- > 0 &&
        this.position < this.log.records.length
      ) {
        this.advance();
      }
      if (this.position >= this.log.records.length) this.playing = false;
      else if (this.playing && !this.waitingFor)
        this.timer = this.clock.setTimeout(() => this.schedule(), 0);
      this.emit();
      return;
    }
    const delay = this.delayBefore(this.position) / this.opts.speed;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.advance();
      this.schedule();
      this.emit();
    }, delay);
  }

  private delayBefore(index: number): number {
    const t = this.log.records[index]?.t ?? 0;
    const previous = index === 0 ? 0 : (this.log.records[index - 1]?.t ?? 0);
    const gap = t - previous;
    return this.opts.gapCapMs === null ? gap : Math.min(gap, this.opts.gapCapMs);
  }

  private cancel(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(): void {
    this.callbacks.status?.(this.status);
  }
}

function sameIgnoringCommandId(a: Command, b: Command): boolean {
  const strip = (c: Command) => ({ ...c, commandId: undefined });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
