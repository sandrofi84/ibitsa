import type { Command } from '@ibitsa/protocol';
import type { LogRecord } from './log';

export interface ReplayOptions {
  /** Playback rate; `instant` feeds everything at once (tests). */
  speed: number | 'instant';
  /** Pauses longer than this (in log time) are shortened to it; `null` keeps exact timing. */
  gapCapMs: number | null;
  loop: boolean;
  /** `interactive` pauses at each recorded command until a live command of the same type replaces it. */
  mode: 'auto' | 'interactive';
  /** In interactive mode, the command types to wait for; others replay as recorded. Default: all. */
  interactiveTypes: Command['type'][] | null;
}

export interface ReplayStatus {
  position: number;
  total: number;
  playing: boolean;
  finished: boolean;
  /** In interactive mode: the command type the replay is waiting for. */
  waitingFor: Command['type'] | null;
  /** A live command differed from the recorded one; later records may no longer fit. */
  diverged: boolean;
}

export interface ReplayCallbacks {
  /** Feed one record to the core. */
  feed(record: LogRecord): void;
  /** Called before looping: start a fresh core. */
  restart?(): void;
  status?(status: ReplayStatus): void;
}

export interface Clock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
