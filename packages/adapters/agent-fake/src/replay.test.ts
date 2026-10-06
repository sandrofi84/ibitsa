import { describe, expect, it } from 'vitest';
import type { EventLog, LogRecord } from './log';
import { Replay } from './replay';
import type { Clock, ReplayOptions, ReplayStatus } from './replay.types';

/** A manual clock: `advance(ms)` runs due callbacks in order. */
class FakeClock implements Clock {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }
  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.now = next.at;
      next.fn();
    }
    this.now = end;
  }
  /** Run only the callbacks queued right now (zero-delay callbacks may queue more). */
  runPending(): void {
    const pending = this.queue;
    this.queue = [];
    for (const q of pending) q.fn();
  }
}

const log: EventLog = {
  header: {
    kind: 'header',
    logVersion: 1,
    protocolVersion: 1,
    campaignId: 'c1',
    startedAt: '2026-10-04T15:00:00.000Z',
  },
  tornTail: false,
  records: [
    { kind: 'agent', t: 1_000, heroId: 'h4', event: { type: 'turnStarted' } },
    {
      kind: 'command',
      t: 2_000,
      command: { type: 'answerPermission', commandId: 'a1', itemId: 'n5', decision: 'allow' },
    },
    { kind: 'agent', t: 12_000, heroId: 'h4', event: { type: 'turnEnded', queuedTurns: 0 } },
  ],
};

function setup(options: Partial<ReplayOptions> = {}) {
  const clock = new FakeClock();
  const fed: { at: number; record: LogRecord }[] = [];
  const statuses: ReplayStatus[] = [];
  let restarts = 0;
  const replay = new Replay({
    log,
    callbacks: {
      feed: (record) => fed.push({ at: clock.now, record }),
      restart: () => restarts++,
      status: (s) => statuses.push(s),
    },
    options,
    clock,
  });
  return { clock, fed, statuses, replay, restarts: () => restarts };
}

describe('Replay', () => {
  it('keeps recorded timing at 1×, shortening gaps over the cap', () => {
    const { clock, fed, replay } = setup({ speed: 1, gapCapMs: 3_000 });
    replay.play();
    clock.advance(60_000);
    expect(fed.map((f) => f.at)).toEqual([1_000, 2_000, 5_000]); // the 10 s gap becomes 3 s
  });

  it('keeps exact timing with the gap cap off, and scales by speed', () => {
    const { clock, fed, replay } = setup({ speed: 4, gapCapMs: null });
    replay.play();
    clock.advance(60_000);
    expect(fed.map((f) => f.at)).toEqual([250, 500, 3_000]);
  });

  it('changes speed mid-play, from the next record on, and reports its options', () => {
    const { clock, fed, replay } = setup({ speed: 1, gapCapMs: null });
    replay.play();
    clock.advance(1_000);
    expect(fed.map((f) => f.at)).toEqual([1_000]);
    replay.setOptions({ speed: 'instant' });
    expect(replay.options.speed).toBe('instant');
    expect(fed).toHaveLength(3);
  });

  it('feeds everything at once at instant speed', () => {
    const { fed, replay } = setup({ speed: 'instant' });
    replay.play();
    expect(fed).toHaveLength(3);
    expect(replay.status).toMatchObject({ finished: true, playing: false });
  });

  it('pauses and steps one record at a time', () => {
    const { clock, fed, replay } = setup();
    replay.play();
    clock.advance(1_500);
    replay.pause();
    clock.advance(60_000);
    expect(fed).toHaveLength(1);
    replay.step();
    expect(fed).toHaveLength(2);
    expect(replay.status.position).toBe(2);
  });

  it('loops with a fresh core', () => {
    const { clock, fed, replay, restarts } = setup({ speed: 'instant', loop: true });
    replay.play();
    expect(restarts()).toBe(1);
    clock.runPending();
    expect(fed.length).toBeGreaterThan(3);
    replay.pause();
  });

  it('rejects live commands in auto mode', () => {
    const { replay } = setup();
    expect(
      replay.submitLive({
        type: 'answerPermission',
        commandId: 'live',
        itemId: 'n5',
        decision: 'allow',
      }),
    ).toBe(false);
  });

  describe('interactive mode', () => {
    it('waits at a recorded command and feeds the live one instead', () => {
      const { clock, fed, replay } = setup({ mode: 'interactive' });
      replay.play();
      clock.advance(60_000);
      expect(fed).toHaveLength(1);
      expect(replay.status.waitingFor).toBe('answerPermission');

      expect(replay.submitLive({ type: 'stopHero', commandId: 'x', heroId: 'h4' })).toBe(false);
      const live = {
        type: 'answerPermission',
        commandId: 'live',
        itemId: 'n5',
        decision: 'allow',
      } as const;
      expect(replay.submitLive(live)).toBe(true);
      expect(fed[1]?.record).toEqual({ kind: 'command', t: 2_000, command: live });
      expect(replay.status.diverged).toBe(false);
      clock.advance(60_000);
      expect(fed).toHaveLength(3);
    });

    it('replays command types it is not told to wait for', () => {
      const { clock, fed, replay } = setup({ mode: 'interactive', interactiveTypes: ['stopHero'] });
      replay.play();
      clock.advance(60_000);
      expect(fed).toHaveLength(3);
    });

    it('flags a live command that differs from the recording', () => {
      const { clock, replay } = setup({ mode: 'interactive' });
      replay.play();
      clock.advance(60_000);
      replay.submitLive({
        type: 'answerPermission',
        commandId: 'live',
        itemId: 'n5',
        decision: 'deny',
      });
      expect(replay.status.diverged).toBe(true);
    });
  });
});
