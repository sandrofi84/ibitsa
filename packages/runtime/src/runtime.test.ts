import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameMasterEvent, parseLog, SILENCE_MS, view } from '@ibitsa/core';
import type { AgentEvent, Command, CoreMessage } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter, AgentSession, Clock, GameMaster, SessionStart } from './ports';
import { Runtime, SNAPSHOT_INTERVAL_MS } from './runtime';

class ManualClock implements Clock {
  private ms = Date.parse('2026-10-04T15:00:00.000Z');
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.ms;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ at: this.ms + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }
  advance(ms: number): void {
    const end = this.ms + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.ms = next.at;
      next.fn();
    }
    this.ms = end;
  }
  get pending(): number {
    return this.queue.length;
  }
}

class FakeSession implements AgentSession {
  calls: unknown[][] = [];
  constructor(
    readonly start: SessionStart,
    readonly emit: (e: AgentEvent) => void,
  ) {}
  send(...args: unknown[]) {
    this.calls.push(['send', ...args]);
  }
  interrupt() {
    this.calls.push(['interrupt']);
  }
  respondToPermission(...args: unknown[]) {
    this.calls.push(['respondToPermission', ...args]);
  }
  answerQuestion(...args: unknown[]) {
    this.calls.push(['answerQuestion', ...args]);
  }
  completeSubmit(...args: unknown[]) {
    this.calls.push(['completeSubmit', ...args]);
  }
  close() {
    this.calls.push(['close']);
  }
}

class FakeAdapter implements AgentAdapter {
  sessions: FakeSession[] = [];
  startSession(start: SessionStart, onEvent: (e: AgentEvent) => void): AgentSession {
    const s = new FakeSession(start, onEvent);
    this.sessions.push(s);
    return s;
  }
}

class FakeGameMaster implements GameMaster {
  requests: unknown[] = [];
  submitOk = true;
  async createWorktree(r: {
    islandId: string;
    branch: string;
    baseRef: string;
  }): Promise<GameMasterEvent> {
    this.requests.push(['createWorktree', r]);
    return {
      type: 'worktreeCreated',
      islandId: r.islandId,
      path: `/wt/${r.branch}`,
      branch: r.branch,
    };
  }
  async checkSubmit(r: {
    heroId: string;
    toolUseId: string;
    worktreePath: string;
    baseRef: string;
  }): Promise<GameMasterEvent> {
    this.requests.push(['checkSubmit', r]);
    return { type: 'submitChecked', heroId: r.heroId, toolUseId: r.toolUseId, ok: this.submitOk };
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'))) {
  if (!dirs.includes(storageDir)) dirs.push(storageDir);
  const clock = new ManualClock();
  const adapter = new FakeAdapter();
  const gameMaster = new FakeGameMaster();
  let n = 0;
  const runtime = new Runtime({
    storageDir,
    adapter,
    gameMaster,
    clock,
    newId: () => `camp-${++n}`,
  });
  runtime.start();
  const received: CoreMessage[] = [];
  const connection = runtime.connect({ post: (m) => received.push(m) });
  return { storageDir, clock, adapter, gameMaster, runtime, received, connection };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const startQuest: Command = {
  type: 'startQuest',
  commandId: 'q1',
  description: 'Fix the login redirect',
  heroName: 'Ranger Ilse',
  classId: 'ranger',
  baseRef: 'main',
};
const logOf = (storageDir: string, id = 'camp-1') =>
  parseLog(readFileSync(join(storageDir, 'campaigns', id, 'events.jsonl'), 'utf8'));

/** Start a quest and let the worktree and session come up. */
async function arrived() {
  const env = setup();
  env.connection.receive(startQuest);
  await flush();
  const session = env.adapter.sessions[0];
  if (!session) throw new Error('no session started');
  session.emit({ type: 'sessionStarted', sessionId: session.start.sessionId });
  return { ...env, session };
}

describe('front ends', () => {
  it('answers hello with welcome and a snapshot, in seq order', () => {
    const { connection, received } = setup();
    connection.receive({ type: 'hello', protocolVersion: 1 });
    expect(received.map((m) => [m.type, m.seq])).toEqual([
      ['welcome', 1],
      ['snapshot', 2],
    ]);
  });

  it('rejects invalid commands without touching state', () => {
    const { connection, received } = setup();
    connection.receive({
      type: 'answerPermission',
      commandId: 'x1',
      itemId: 'n1',
      decision: 'maybe',
    });
    expect(received).toEqual([
      {
        type: 'cue',
        seq: 1,
        cue: expect.objectContaining({
          type: 'commandRejected',
          commandId: 'x1',
          reason: expect.stringContaining('Invalid command'),
        }),
      },
    ]);
  });

  it('throttles snapshots to one per interval with the latest state', async () => {
    const { clock, received, session } = await arrived();
    const before = received.filter((m) => m.type === 'snapshot').length;
    for (const kind of ['read', 'search', 'edit'] as const) {
      session.emit({ type: 'activityStarted', toolUseId: kind, kind });
    }
    expect(received.filter((m) => m.type === 'snapshot').length).toBe(before);
    clock.advance(SNAPSHOT_INTERVAL_MS);
    const snapshots = received.filter((m) => m.type === 'snapshot');
    expect(snapshots.length).toBe(before + 1);
    const last = snapshots.at(-1);
    expect(last?.type === 'snapshot' && last.snapshot.heroes[0]?.activity).toEqual({
      kind: 'edit',
    });
    const seqs = received.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});

describe('effects and the log', () => {
  it('logs every input before stepping and carries out effects in order', async () => {
    const { storageDir, gameMaster, adapter, session } = await arrived();
    expect(gameMaster.requests).toEqual([
      [
        'createWorktree',
        {
          type: 'createWorktree',
          islandId: 'i2',
          branch: 'ibitsa/fix-the-login-redirect',
          baseRef: 'main',
        },
      ],
    ]);
    expect(adapter.sessions).toHaveLength(1);
    expect(session.start).toMatchObject({
      heroId: 'h4',
      cwd: '/wt/ibitsa/fix-the-login-redirect',
      classId: 'ranger',
      prompt: 'Fix the login redirect',
    });
    const log = logOf(storageDir);
    expect(log.header).toMatchObject({ kind: 'header', logVersion: 1, campaignId: 'camp-1' });
    expect(log.records.map((r) => r.kind)).toEqual(['command', 'gm', 'agent']);
  });

  it('routes answers, messages and stops to the hero session', async () => {
    const { connection, session } = await arrived();
    session.emit({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'pnpm test' },
    });
    connection.receive({
      type: 'answerPermission',
      commandId: 'a1',
      itemId: 'n5',
      decision: 'allow',
    });
    connection.receive({
      type: 'sendMessage',
      commandId: 'm1',
      heroId: 'h4',
      text: 'also docs',
      priority: 'next',
    });
    connection.receive({ type: 'stopHero', commandId: 's1', heroId: 'h4' });
    expect(session.calls).toEqual([
      ['respondToPermission', 'r1', 'allow', undefined],
      ['send', 'also docs', 'next'],
      ['interrupt'],
    ]);
  });

  it('runs the submit check with the hero worktree and returns the result to the hero', async () => {
    const { gameMaster, session } = await arrived();
    session.emit({ type: 'taskSubmitted', toolUseId: 'u9', summary: 'done' });
    await flush();
    expect(gameMaster.requests.at(-1)).toEqual([
      'checkSubmit',
      {
        type: 'checkSubmit',
        heroId: 'h4',
        toolUseId: 'u9',
        worktreePath: '/wt/ibitsa/fix-the-login-redirect',
        baseRef: 'main',
      },
    ]);
    expect(session.calls.at(-1)).toEqual(['completeSubmit', 'u9', true, undefined]);
  });

  it('fires timers as logged inputs', async () => {
    const { clock, runtime, storageDir } = await arrived();
    clock.advance(SILENCE_MS);
    expect(view(runtime.snapshotState).heroes[0]?.state).toEqual({
      kind: 'unknown',
      reason: 'No events for 5 min.',
    });
    expect(logOf(storageDir).records.at(-1)).toMatchObject({
      kind: 'timer',
      timerId: 'silence:h4',
    });
  });

  it('starts a new campaign log after the quest ends', async () => {
    const { connection, session, storageDir } = await arrived();
    session.emit({ type: 'turnEnded', queuedTurns: 0 });
    connection.receive({ type: 'abandonQuest', commandId: 'x' });
    expect(session.calls.at(-1)).toEqual(['close']);
    connection.receive({ ...startQuest, commandId: 'q2' });
    await flush();
    expect(logOf(storageDir, 'camp-2').records[0]).toMatchObject({
      kind: 'command',
      command: { commandId: 'q2' },
    });
  });
});

describe('recovery', () => {
  it('rebuilds the same state from the log without carrying out effects again', async () => {
    const first = await arrived();
    first.session.emit({
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'test',
      detail: 'pnpm test',
    });
    first.session.emit({ type: 'activityFinished', toolUseId: 'u1', outcome: 'failed' });
    const expected = JSON.stringify(view(first.runtime.snapshotState));
    first.runtime.dispose();

    const second = setup(first.storageDir);
    expect(JSON.stringify(view(second.runtime.snapshotState))).toBe(expected);
    expect(second.gameMaster.requests).toEqual([]);
    expect(second.adapter.sessions).toEqual([]);
  });

  it('re-arms timers that were pending', async () => {
    const first = await arrived();
    first.runtime.dispose();
    const second = setup(first.storageDir);
    expect(second.clock.pending).toBe(1);
    second.clock.advance(SILENCE_MS);
    expect(view(second.runtime.snapshotState).heroes[0]?.state.kind).toBe('unknown');
  });

  it('tolerates a torn last line', async () => {
    const first = await arrived();
    first.runtime.dispose();
    appendFileSync(
      join(first.storageDir, 'campaigns', 'camp-1', 'events.jsonl'),
      '{"t":9,"kind":"agent","he',
    );
    const second = setup(first.storageDir);
    expect(view(second.runtime.snapshotState).heroes[0]?.state.kind).toBe('working');
  });

  it('does not resume a campaign that has ended', async () => {
    const first = await arrived();
    first.connection.receive({ type: 'abandonQuest', commandId: 'x' });
    first.runtime.dispose();
    const second = setup(first.storageDir);
    expect(view(second.runtime.snapshotState).campaign).toBeNull();
  });
});
