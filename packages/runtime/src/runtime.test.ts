import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameMasterEvent, parseLog, SILENCE_MS, view } from '@ibitsa/core';
import type { AgentEvent, Command, CoreMessage } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentAdapter,
  AgentSession,
  Clock,
  GameMaster,
  SessionResume,
  SessionStart,
  UserSettings,
} from './ports';
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
  capabilities = { budgetCap: true, costReported: true };
  sessions: FakeSession[] = [];
  resumed: SessionResume[] = [];
  startSession(start: SessionStart, onEvent: (e: AgentEvent) => void): AgentSession {
    const s = new FakeSession(start, onEvent);
    this.sessions.push(s);
    return s;
  }
  resumeSession(resume: SessionResume, onEvent: (e: AgentEvent) => void): AgentSession {
    this.resumed.push(resume);
    const s = new FakeSession({ ...resume, prompt: resume.prompt ?? '' }, onEvent);
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
  diffHash = 'same';
  async observeDiff(r: { worktreePath: string }): Promise<string> {
    this.requests.push(['observeDiff', r]);
    return this.diffHash;
  }
  removeOk = true;
  async removeWorktree(r: {
    worktreePath: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.requests.push(['removeWorktree', r]);
    return this.removeOk
      ? { ok: true }
      : { ok: false, reason: 'The worktree has uncommitted changes.' };
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(
  storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-')),
  settings?: UserSettings,
) {
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
    ...(settings ? { settings: () => settings } : {}),
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
async function arrived(settings?: UserSettings) {
  const env = setup(undefined, settings);
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
    expect(log.records.map((r) => r.kind)).toEqual(['gm', 'command', 'gm', 'agent']);
    expect(log.records[0]).toMatchObject({
      kind: 'gm',
      event: { type: 'questSettings', budgetMicroUsd: null, budget: 'native' },
    });
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
      ['respondToPermission', { requestId: 'r1', decision: 'allow' }],
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
    expect(session.calls.at(-1)).toEqual(['completeSubmit', { toolUseId: 'u9', accepted: true }]);
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
    expect(logOf(storageDir, 'camp-2').records[1]).toMatchObject({
      kind: 'command',
      command: { commandId: 'q2' },
    });
  });
});

describe('settings', () => {
  it('logs the user budget with the enforcement the adapter supports', async () => {
    const { storageDir, session } = await arrived({
      budgetMicroUsd: 2_000_000,
      stall: { testFailures: 3, fileEdits: 10, noProgressTurns: 5 },
    });
    expect(logOf(storageDir).records[0]).toMatchObject({
      event: {
        type: 'questSettings',
        budgetMicroUsd: 2_000_000,
        budget: 'native',
        stall: { testFailures: 3 },
      },
    });
    expect(session.start.maxBudgetMicroUsd).toBe(2_000_000);
  });
});

describe('M1 effects', () => {
  it('observes the diff after each turn', async () => {
    const { gameMaster, session, storageDir } = await arrived();
    session.emit({ type: 'turnEnded', queuedTurns: 0 });
    await flush();
    expect(gameMaster.requests).toContainEqual([
      'observeDiff',
      { worktreePath: '/wt/ibitsa/fix-the-login-redirect' },
    ]);
    expect(logOf(storageDir).records.at(-1)).toMatchObject({
      kind: 'gm',
      event: { type: 'diffObserved', hash: 'same' },
    });
  });

  it('removes a finished quest worktree, and reports a refusal', async () => {
    const { connection, gameMaster, received } = await arrived();
    connection.receive({ type: 'abandonQuest', commandId: 'x' });
    gameMaster.removeOk = false;
    connection.receive({ type: 'removeWorktree', commandId: 'w1', islandId: 'i2' });
    await flush();
    expect(received).toContainEqual(
      expect.objectContaining({
        cue: {
          type: 'commandRejected',
          commandId: 'w1',
          reason: 'The worktree has uncommitted changes.',
        },
      }),
    );
  });
});

describe('recovery', () => {
  it('rebuilds the campaign from the log without carrying out effects again, then marks the hero not resumed', async () => {
    const first = await arrived();
    first.session.emit({
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'test',
      detail: 'pnpm test',
    });
    first.session.emit({ type: 'activityFinished', toolUseId: 'u1', outcome: 'failed' });
    const before = view(first.runtime.snapshotState);
    first.runtime.dispose();

    const second = setup(first.storageDir);
    const after = view(second.runtime.snapshotState);
    expect(after.campaign).toEqual(before.campaign);
    expect(after.islands).toEqual(before.islands);
    expect(after.heroes[0]?.state).toEqual({
      kind: 'unknown',
      reason: 'Session not resumed after a restart.',
    });
    expect(after.needsYou.map((i) => i.kind)).toEqual(['error']);
    expect(second.gameMaster.requests).toEqual([]);
    expect(second.adapter.sessions).toEqual([]);
    expect(logOf(first.storageDir).records.at(-1)).toMatchObject({
      kind: 'gm',
      event: { type: 'runtimeRestarted' },
    });
  });

  it('resumes the session by id when you choose resume', async () => {
    const first = await arrived();
    first.runtime.dispose();
    const second = setup(first.storageDir);
    second.connection.receive({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    expect(second.adapter.resumed).toEqual([
      expect.objectContaining({
        heroId: 'h4',
        sessionId: first.session.start.sessionId,
        cwd: '/wt/ibitsa/fix-the-login-redirect',
      }),
    ]);
    expect(second.clock.pending).toBeGreaterThan(0); // silence timer armed for the resumed session
  });

  it('tolerates a torn last line', async () => {
    const first = await arrived();
    first.runtime.dispose();
    appendFileSync(
      join(first.storageDir, 'campaigns', 'camp-1', 'events.jsonl'),
      '{"t":9,"kind":"agent","he',
    );
    const second = setup(first.storageDir);
    expect(view(second.runtime.snapshotState).campaign?.status).toBe('active');
  });

  it('does not resume a campaign that has ended', async () => {
    const first = await arrived();
    first.connection.receive({ type: 'abandonQuest', commandId: 'x' });
    first.runtime.dispose();
    const second = setup(first.storageDir);
    expect(view(second.runtime.snapshotState).campaign).toBeNull();
  });
});
