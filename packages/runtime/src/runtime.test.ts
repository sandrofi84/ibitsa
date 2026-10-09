import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type GameMasterEvent, parseLog, RESTART_PROMPT, SILENCE_MS, view } from '@ibitsa/core';
import type {
  AgentEvent,
  Command,
  CoreMessage,
  CouncilEvent,
  CouncillorInfo,
  ElderEvent,
  RepoView,
  ResearchBrief,
  ReviewEvent,
  Snapshot,
} from '@ibitsa/protocol';
import { resolveClasses } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { councilVersion } from './council';
import { KeptCouncil } from './kept-council';
import type {
  AgentAdapter,
  AgentSession,
  Clock,
  CreateActionRequest,
  CreateActionResult,
  ElderStart,
  GameMaster,
  ReviewStart,
  SessionResume,
  SessionStart,
  SittingStart,
  UserSettings,
} from './ports.types';
import { Runtime, SNAPSHOT_INTERVAL_MS } from './runtime';
import type { SessionCaps } from './runtime.types';

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
  compact() {
    this.calls.push(['compact']);
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
  repo: RepoView | null = {
    defaultBranch: 'main',
    branches: ['main', 'feature'],
    uncommittedChanges: 2,
  };
  scans = 0;
  async scanRepo(): Promise<RepoView | null> {
    this.scans++;
    return this.repo;
  }
  async listFiles(r: { worktreePath: string }): Promise<string[]> {
    this.requests.push(['listFiles', r]);
    return ['README.md', 'src/app.ts'];
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

describe('the repo scan', () => {
  it('adds the repo to snapshots and rescans on hello', async () => {
    const { connection, gameMaster, received } = setup();
    await flush();
    connection.receive({ type: 'hello', protocolVersion: 1 });
    await flush();
    const snapshots = received.filter((m) => m.type === 'snapshot');
    const last = snapshots.at(-1);
    expect(last?.type === 'snapshot' && last.snapshot.repo).toEqual({
      defaultBranch: 'main',
      branches: ['main', 'feature'],
      uncommittedChanges: 2,
    });
    expect(gameMaster.scans).toBe(2); // on start and on hello
  });

  it('reports a workspace that is not a git repository as repo: null', async () => {
    const { clock, connection, gameMaster, received } = setup();
    gameMaster.repo = null;
    connection.receive({ type: 'hello', protocolVersion: 1 });
    await flush();
    clock.advance(SNAPSHOT_INTERVAL_MS); // the rescan's snapshot falls inside the throttle window
    const last = received.filter((m) => m.type === 'snapshot').at(-1);
    expect(last?.type === 'snapshot' && last.snapshot.repo).toBeNull();
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

describe('the / menu (#84)', () => {
  const action = (name: string) => ({
    name,
    description: '',
    argumentHint: '',
    aliases: [],
    source: 'project' as const,
    target: 'any' as const,
  });
  const actionsOf = (received: CoreMessage[]) =>
    received
      .filter((m) => m.type === 'actions')
      .map((m) => (m.type === 'actions' ? m.actions : []));

  async function withActions(list: (cwd: string) => Promise<ReturnType<typeof action>[]>) {
    const env = await arrived();
    const adapter = Object.assign(env.adapter, {
      listActions: ({ cwd }: { cwd: string }) => list(cwd),
    });
    const fire: (() => void)[] = [];
    // A home with a .claude folder, so there's something to watch whatever machine runs this (CI has none).
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(home);
    mkdirSync(join(home, '.claude'));
    const runtime = new Runtime({
      storageDir: env.storageDir,
      adapter,
      gameMaster: env.gameMaster,
      clock: env.clock,
      home,
      watchFolder: ({ onChange }) => {
        fire.push(onChange);
        return { close: () => {} };
      },
    });
    env.runtime.dispose();
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    return { connection, received, fire };
  }

  it('lists none without a quest', async () => {
    const env = setup();
    env.connection.receive({ type: 'requestActions' });
    await flush();
    expect(actionsOf(env.received)).toEqual([[]]);
  });

  it("lists the hero's worktree once, and sends a fresh list when a skill changes", async () => {
    let calls = 0;
    const cwds: string[] = [];
    const { connection, received, fire } = await withActions(async (cwd) => {
      cwds.push(cwd);
      return [action(`v${++calls}`)];
    });
    connection.receive({ type: 'requestActions' });
    connection.receive({ type: 'requestActions' });
    await flush();
    expect(actionsOf(received)).toEqual([[action('v1')], [action('v1')]]);
    expect(cwds).toEqual(['/wt/ibitsa/fix-the-login-redirect']);
    for (const f of fire) f();
    await flush();
    expect(actionsOf(received).at(-1)).toEqual([action('v2')]);
  });

  it("lists a named hero's worktree and says whose list it is; an unknown hero gets the first (#125)", async () => {
    const cwds: string[] = [];
    const { connection, received } = await withActions(async (cwd) => {
      cwds.push(cwd);
      return [action('a')];
    });
    connection.receive({ type: 'requestActions', heroId: 'h4' });
    connection.receive({ type: 'requestActions', heroId: 'nobody' });
    connection.receive({ type: 'requestPreview', name: 'a', args: '', heroId: 'h4' });
    await flush();
    const answers = received.filter((m) => m.type === 'actions');
    expect(answers.map((m) => m.type === 'actions' && m.heroId)).toEqual(['h4', 'nobody']);
    expect(cwds).toEqual(['/wt/ibitsa/fix-the-login-redirect']);
    const preview = received.find((m) => m.type === 'preview');
    expect(preview?.type === 'preview' && preview.heroId).toBe('h4');
  });

  it('gives the current actions to the host too (#87)', async () => {
    const { runtime } = setup();
    expect(await runtime.currentActions()).toEqual([]);
  });

  it('lists none when listing fails', async () => {
    const { connection, received } = await withActions(async () => {
      throw new Error('no CLI');
    });
    connection.receive({ type: 'requestActions' });
    await flush();
    expect(actionsOf(received)).toEqual([[]]);
  });
});

describe('the action preview (#85)', () => {
  const previewsOf = (received: CoreMessage[]) =>
    received.flatMap((m) => (m.type === 'preview' ? [m.preview] : []));

  it("expands an action for the hero's worktree, and has no text without a quest or a reader", async () => {
    const none = setup();
    none.connection.receive({ type: 'requestPreview', name: 'pr', args: 'x' });
    expect(previewsOf(none.received)).toEqual([{ name: 'pr', args: 'x', text: null, notes: [] }]);

    const env = await arrived();
    env.connection.receive({ type: 'requestPreview', name: 'pr', args: 'x' });
    expect(previewsOf(env.received).at(-1)).toEqual({
      name: 'pr',
      args: 'x',
      text: null,
      notes: [],
    });

    const asked: unknown[] = [];
    Object.assign(env.adapter, {
      previewAction: async (r: { cwd: string; name: string; args: string }) => {
        asked.push(r);
        return r.name === 'pr' ? { text: `PR for ${r.args}`, notes: ['n'] } : null;
      },
    });
    env.connection.receive({ type: 'requestPreview', name: 'pr', args: 'alice' });
    env.connection.receive({ type: 'requestPreview', name: 'nope', args: '' });
    await flush();
    expect(asked[0]).toEqual({
      cwd: '/wt/ibitsa/fix-the-login-redirect',
      name: 'pr',
      args: 'alice',
    });
    expect(previewsOf(env.received).slice(-2)).toEqual([
      { name: 'pr', args: 'alice', text: 'PR for alice', notes: ['n'] },
      { name: 'nope', args: '', text: null, notes: [] },
    ]);
  });

  it('a failing reader means no text', async () => {
    const env = await arrived();
    Object.assign(env.adapter, {
      previewAction: async () => {
        throw new Error('unreadable');
      },
    });
    env.connection.receive({ type: 'requestPreview', name: 'pr', args: '' });
    await flush();
    expect(previewsOf(env.received).at(-1)?.text).toBeNull();
  });
});

describe('new actions (#86)', () => {
  const draft = {
    name: 'pr-summary',
    description: 'Summarize the PR',
    argumentHint: '[focus]',
    prompt: 'Summarize. $ARGUMENTS',
    target: 'hero' as const,
    scope: 'project' as const,
  };
  type Create = (request: CreateActionRequest) => Promise<CreateActionResult>;

  async function withCreate({ create, repoDir }: { create: Create | null; repoDir?: string }) {
    const env = await arrived();
    const requests: CreateActionRequest[] = [];
    let listings = 0;
    const adapter = Object.assign(env.adapter, {
      listActions: async () => {
        listings += 1;
        return [];
      },
      ...(create
        ? {
            createAction: (r: CreateActionRequest) => {
              requests.push(r);
              return create(r);
            },
          }
        : {}),
    });
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(home);
    mkdirSync(join(home, '.claude'));
    const runtime = new Runtime({
      storageDir: env.storageDir,
      adapter,
      gameMaster: env.gameMaster,
      clock: env.clock,
      home,
      ...(repoDir ? { repoDir } : {}),
      watchFolder: () => ({ close: () => {} }),
    });
    env.runtime.dispose();
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    return { connection, received, requests, home, listings: () => listings };
  }
  const replies = (received: CoreMessage[]) =>
    received.filter((m) => m.type === 'actionCreated' || m.type === 'actionRejected');

  it("writes the skill with both scopes' folders, then refreshes the / menu", async () => {
    const env = await withCreate({
      create: async () => ({ ok: true, path: '/x' }),
      repoDir: '/repo',
    });
    env.connection.receive({ type: 'requestActions' });
    await flush();
    env.connection.receive({ type: 'createAction', ...draft });
    await flush();
    await flush();
    expect(env.requests).toEqual([
      { draft, overwrite: false, roots: { personal: env.home, project: '/repo' } },
    ]);
    expect(replies(env.received)).toEqual([
      expect.objectContaining({ type: 'actionCreated', name: 'pr-summary' }),
    ]);
    expect(env.listings()).toBe(2);
    expect(env.received.filter((m) => m.type === 'actions')).toHaveLength(2);
  });

  it('passes a clash back, and an overwrite along', async () => {
    const env = await withCreate({
      create: async () => ({ ok: false, reason: 'taken', clash: true }),
      repoDir: '/repo',
    });
    env.connection.receive({ type: 'createAction', ...draft, overwrite: true });
    await flush();
    expect(env.requests).toEqual([expect.objectContaining({ overwrite: true })]);
    expect(replies(env.received)).toEqual([
      expect.objectContaining({ type: 'actionRejected', reason: 'taken', clash: true }),
    ]);
  });

  it('refuses without a project folder, without actions, or when writing throws', async () => {
    const noRepo = await withCreate({ create: async () => ({ ok: true, path: '/x' }) });
    noRepo.connection.receive({ type: 'createAction', ...draft });
    const noActions = await withCreate({ create: null, repoDir: '/repo' });
    noActions.connection.receive({ type: 'createAction', ...draft });
    const throws = await withCreate({
      create: async () => {
        throw new Error('disk full');
      },
      repoDir: '/repo',
    });
    throws.connection.receive({ type: 'createAction', ...draft, scope: 'personal' });
    await flush();
    expect(replies(noRepo.received)).toEqual([
      expect.objectContaining({
        reason: 'There is no project folder to save it in.',
        clash: false,
      }),
    ]);
    expect(replies(noActions.received)).toEqual([
      expect.objectContaining({ reason: 'This agent has no actions.' }),
    ]);
    expect(replies(throws.received)).toEqual([
      expect.objectContaining({ reason: expect.stringContaining('disk full') }),
    ]);
  });
});

describe('auto mode (#63)', () => {
  it('says whether hero commands run in a sandbox here', () => {
    const env = setup();
    env.connection.receive({ type: 'hello', protocolVersion: 1 });
    const snapshot = env.received.find((m) => m.type === 'snapshot');
    expect(snapshot?.type === 'snapshot' && snapshot.snapshot.sandboxed).toBe(
      process.platform !== 'win32',
    );
    const windows = new Runtime({
      storageDir: env.storageDir,
      adapter: env.adapter,
      gameMaster: env.gameMaster,
      clock: env.clock,
      platform: 'win32',
    });
    const got: CoreMessage[] = [];
    windows.connect({ post: (m) => got.push(m) }).receive({ type: 'hello', protocolVersion: 1 });
    const winSnapshot = got.find((m) => m.type === 'snapshot');
    expect(winSnapshot?.type === 'snapshot' && winSnapshot.snapshot.sandboxed).toBe(false);
  });

  it('answers permissions itself while on, never adding them to Needs you', async () => {
    const env = await arrived();
    env.connection.receive({ type: 'setAutoApprove', commandId: 'a', on: true });
    env.session.emit({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'npm i' },
    });
    expect(env.session.calls).toContainEqual([
      'respondToPermission',
      { requestId: 'r1', decision: 'allow' },
    ]);
    expect(
      logOf(env.storageDir).records.some(
        (r) => r.kind === 'command' && r.command.type === 'setAutoApprove',
      ),
    ).toBe(true);
  });
});

describe('always allow (#62)', () => {
  const ask = (session: { emit: (e: AgentEvent) => void }, alwaysAllow: string[]) =>
    session.emit({
      type: 'permission',
      requestId: 'r1',
      tool: 'Bash',
      input: { command: 'npm test' },
      alwaysAllow,
    });
  const lastSnapshot = (received: CoreMessage[]) =>
    (received.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot } | undefined)
      ?.snapshot;

  it('for the project: keeps the rules, shows them, and passes them to the next session', async () => {
    const env = await arrived();
    ask(env.session, ['Bash(npm test:*)']);
    env.connection.receive({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'project',
    });
    expect(env.session.calls).toContainEqual([
      'respondToPermission',
      { requestId: 'r1', decision: 'allow', always: true },
    ]);
    env.clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(lastSnapshot(env.received)?.projectRules).toEqual(['Bash(npm test:*)']);

    // A later campaign in the same workspace starts its session with the rule.
    env.connection.receive({ type: 'abandonQuest', commandId: 'x' });
    env.connection.receive({ ...startQuest, commandId: 'q2', description: 'Tidy the README' });
    await flush();
    expect(env.adapter.sessions.at(-1)?.start.allowRules).toEqual(['Bash(npm test:*)']);

    env.connection.receive({ type: 'forgetProjectRule', rule: 'Bash(npm test:*)' });
    env.clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(lastSnapshot(env.received)?.projectRules).toEqual([]);
    expect(JSON.parse(readFileSync(join(env.storageDir, 'project-rules.json'), 'utf8'))).toEqual({
      allow: [],
    });
  });

  it('for this quest: a resumed session gets the quest rules with the project ones', async () => {
    const first = await arrived();
    ask(first.session, ['Bash(npm run lint:*)']);
    first.connection.receive({
      type: 'answerPermission',
      commandId: 'a',
      itemId: 'n5',
      decision: 'allow',
      always: 'quest',
    });
    first.runtime.dispose();
    // The hero was working, so the reload resumes it on its own (#166).
    const second = setup(first.storageDir);
    expect(second.adapter.resumed[0]?.allowRules).toEqual(['Bash(npm run lint:*)']);
  });
});

describe('rest (#82)', () => {
  it('asks the session to compact', async () => {
    const env = await arrived();
    env.connection.receive({ type: 'restHero', commandId: 'r', heroId: 'h4' });
    expect(env.session.calls).toContainEqual(['compact']);
  });
});

describe('file references (#83)', () => {
  it("answers requestFiles with the island's worktree files, never logging it", async () => {
    const env = await arrived();
    const logged = logOf(env.storageDir).records.length;
    env.received.length = 0;
    env.connection.receive({ type: 'requestFiles', islandId: 'i2' });
    await flush();
    expect(env.received).toEqual([
      {
        type: 'files',
        seq: expect.any(Number),
        islandId: 'i2',
        paths: ['README.md', 'src/app.ts'],
      },
    ]);
    expect(env.gameMaster.requests).toContainEqual([
      'listFiles',
      { worktreePath: '/wt/ibitsa/fix-the-login-redirect' },
    ]);
    expect(logOf(env.storageDir).records.length).toBe(logged);
  });

  it('answers with no files for an island without a worktree', async () => {
    const env = setup();
    env.connection.receive({ type: 'requestFiles', islandId: 'nope' });
    await flush();
    expect(env.received.filter((m) => m.type === 'files')).toEqual([
      { type: 'files', seq: expect.any(Number), islandId: 'nope', paths: [] },
    ]);
  });
});

describe('the journal (#58)', () => {
  const journalMessages = (received: CoreMessage[]) =>
    received.filter((m) => m.type === 'journal' || m.type === 'journalAppend');

  it('pushes new lines to every front end as inputs are logged', async () => {
    const { received, session } = await arrived();
    session.emit({ type: 'message', text: 'Looking around.' });
    const appends = received.filter((m) => m.type === 'journalAppend');
    expect(appends.at(-1)).toMatchObject({
      type: 'journalAppend',
      entries: [{ kind: 'said', text: 'Looking around.', heroId: 'h4' }],
    });
    // The quest's first line starts a new journal.
    expect(appends[0]).toMatchObject({
      start: 0,
      entries: [{ kind: 'event', text: 'Quest started: Fix the login redirect' }],
    });
  });

  it('answers requestJournal with a page from the end, or before an index; never logs it', async () => {
    const { connection, received, session, storageDir } = await arrived();
    for (let i = 0; i < 5; i++) session.emit({ type: 'message', text: `line ${i}` });
    const logged = logOf(storageDir).records.length;
    received.length = 0;
    connection.receive({ type: 'requestJournal', limit: 2 });
    connection.receive({ type: 'requestJournal', before: 2, limit: 10 });
    connection.receive({ type: 'requestJournal', before: 999 });
    const [last, first, all] = journalMessages(received);
    expect(last).toMatchObject({ type: 'journal', start: 5, total: 7 });
    expect(last?.entries.map((e) => ('text' in e ? e.text : ''))).toEqual(['line 3', 'line 4']);
    expect(first).toMatchObject({ start: 0, total: 7 });
    expect(first?.entries.map((e) => e.kind)).toEqual(['event', 'event']);
    expect(all?.entries).toHaveLength(7);
    expect(logOf(storageDir).records.length).toBe(logged);
  });

  it('starts a new journal with a new quest, and rebuilds it from the log after a restart', async () => {
    const first = await arrived();
    first.session.emit({ type: 'message', text: 'Before the reload.' });
    first.runtime.dispose();

    const second = setup(first.storageDir);
    second.connection.receive({ type: 'requestJournal' });
    const page = journalMessages(second.received).at(-1);
    expect(page?.entries.map((e) => ('text' in e ? e.text : ''))).toEqual([
      'Quest started: Fix the login redirect',
      'Worktree ready on ibitsa/fix-the-login-redirect.',
      'Before the reload.',
      'VS Code reloaded; resumed the session.',
    ]);

    second.connection.receive({ type: 'abandonQuest', commandId: 'a' });
    second.connection.receive({ ...startQuest, commandId: 'q2', description: 'Tidy the README' });
    const fresh = second.received.filter((m) => m.type === 'journalAppend').at(-1);
    expect(fresh).toMatchObject({
      start: 0,
      entries: [{ kind: 'event', text: 'Quest started: Tidy the README' }],
    });
  });
});

describe('recovery', () => {
  it('rebuilds the campaign from the log without carrying out effects again, then resumes the hero who was working (#166)', async () => {
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
    expect(after.heroes[0]?.state.kind).toBe('working');
    expect(after.needsYou).toEqual([]);
    expect(second.gameMaster.requests).toEqual([]);
    expect(second.adapter.resumed).toEqual([
      expect.objectContaining({
        heroId: 'h4',
        sessionId: first.session.start.sessionId,
        cwd: '/wt/ibitsa/fix-the-login-redirect',
        prompt: RESTART_PROMPT,
      }),
    ]);
    expect(second.clock.pending).toBeGreaterThan(0); // silence timer armed for the resumed session
    // The game connects after the reload: its first hello hears what resumed, once.
    second.connection.receive({ type: 'hello', protocolVersion: 1 });
    second.connection.receive({ type: 'hello', protocolVersion: 1 });
    expect(second.received.filter((m) => m.type === 'cue' && m.cue.type === 'resumed')).toEqual([
      expect.objectContaining({ cue: expect.objectContaining({ heroIds: ['h4'] }) }),
    ]);
    expect(logOf(first.storageDir).records.at(-1)).toMatchObject({
      kind: 'gm',
      event: { type: 'runtimeRestarted' },
    });
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

describe('when the outside world fails', () => {
  const lastSnapshot = (received: CoreMessage[]) =>
    (received.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot } | undefined)
      ?.snapshot;

  it('a worktree that cannot be created becomes an error for the hero', async () => {
    const env = setup();
    env.gameMaster.createWorktree = async () => {
      throw new Error('disk full');
    };
    env.connection.receive(startQuest);
    await flush();
    env.clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(lastSnapshot(env.received)?.needsYou).toEqual([
      expect.objectContaining({ kind: 'error', message: expect.stringContaining('disk full') }),
    ]);
  });

  it('a submit check that cannot run rejects the submission with the reason', async () => {
    const env = await arrived();
    env.gameMaster.checkSubmit = async () => {
      throw new Error('git missing');
    };
    env.session.emit({ type: 'taskSubmitted', toolUseId: 'u9', summary: 'Done.' });
    await flush();
    expect(env.session.calls).toContainEqual([
      'completeSubmit',
      {
        toolUseId: 'u9',
        accepted: false,
        reason: expect.stringContaining('The submit check could not run: Error: git missing'),
      },
    ]);
  });

  it('a failed removal is reported; failed scans, listings and diffs change nothing', async () => {
    const env = await arrived();
    env.gameMaster.removeWorktree = async () => {
      throw new Error('locked');
    };
    env.gameMaster.listFiles = async () => {
      throw new Error('no git');
    };
    env.gameMaster.observeDiff = async () => {
      throw new Error('no git');
    };
    env.gameMaster.scanRepo = async () => {
      throw new Error('no git');
    };
    env.session.emit({ type: 'turnEnded', queuedTurns: 0 });
    env.connection.receive({ type: 'requestFiles', islandId: 'i2' });
    env.connection.receive({ type: 'hello', protocolVersion: 1 });
    env.connection.receive({ type: 'abandonQuest', commandId: 'a' });
    env.connection.receive({ type: 'removeWorktree', commandId: 'w', islandId: 'i2' });
    await flush();
    await flush();
    expect(env.received).toContainEqual(
      expect.objectContaining({ type: 'files', islandId: 'i2', paths: [] }),
    );
    expect(env.received).toContainEqual(
      expect.objectContaining({
        type: 'cue',
        cue: expect.objectContaining({
          type: 'commandRejected',
          commandId: 'w',
          reason: 'Error: locked',
        }),
      }),
    );
  });

  it("a resumed session's events still reach core, and a closed connection gets nothing more", async () => {
    const first = await arrived();
    first.runtime.dispose();
    const second = setup(first.storageDir);
    second.connection.receive({ type: 'resumeHero', commandId: 'r', heroId: 'h4' });
    const resumed = second.adapter.sessions.at(-1);
    resumed?.emit({ type: 'message', text: 'Back at it.' });
    expect(second.runtime.snapshotState.heroes[0]?.lastMessage).toBe('Back at it.');
    second.connection.close();
    const before = second.received.length;
    resumed?.emit({ type: 'message', text: 'Anyone there?' });
    second.clock.advance(SNAPSHOT_INTERVAL_MS);
    expect(second.received.length).toBe(before);
  });
});

describe('the councillors (#98)', () => {
  const councillor = (id: string): CouncillorInfo => ({
    id,
    skill: id,
    title: id,
    description: '',
    source: 'builtin',
    portrait: null,
    model: null,
    tools: ['Read'],
    modes: { planning: true, review: false },
    hash: 'aaa',
  });

  function withCouncillors(options: {
    list: (cwd: string) => Promise<CouncillorInfo[]>;
    repoDir?: string;
    disabled?: string[];
  }) {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(storageDir, home);
    mkdirSync(join(home, '.claude'));
    const fire: (() => void)[] = [];
    const adapter = Object.assign(new FakeAdapter(), {
      listCouncillors: ({ cwd }: { cwd: string }) => options.list(cwd),
    });
    const disabled = options.disabled ?? [];
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      home,
      ...(options.repoDir ? { repoDir: options.repoDir } : {}),
      disabledCouncillors: () => disabled,
      watchFolder: ({ onChange }) => {
        fire.push(onChange);
        return { close: () => {} };
      },
    });
    return { runtime, fire, disabled };
  }

  it("lists the workspace repository's councillors once, without the ones turned off, until a skill changes", async () => {
    const cwds: string[] = [];
    let calls = 0;
    const { runtime, fire, disabled } = withCouncillors({
      repoDir: '/repo',
      disabled: ['designer'],
      list: async (cwd) => {
        cwds.push(cwd);
        calls++;
        return [councillor('designer'), councillor(`tester${calls}`)];
      },
    });
    expect((await runtime.currentCouncillors()).map((c) => c.id)).toEqual(['tester1']);
    disabled.length = 0;
    // Turning one back on needs no new listing: the setting is read each time.
    expect((await runtime.currentCouncillors()).map((c) => c.id)).toEqual(['designer', 'tester1']);
    expect(cwds).toEqual(['/repo']);
    for (const f of fire) f();
    expect((await runtime.currentCouncillors()).map((c) => c.id)).toEqual(['designer', 'tester2']);
    runtime.dispose();
  });

  it('lists none without a repository, without councillor support, or when listing fails', async () => {
    const noRepo = withCouncillors({ list: async () => [councillor('tester')] });
    expect(await noRepo.runtime.currentCouncillors()).toEqual([]);
    const failing = withCouncillors({
      repoDir: '/repo',
      list: async () => {
        throw new Error('unreadable');
      },
    });
    expect(await failing.runtime.currentCouncillors()).toEqual([]);
    const { runtime } = setup();
    expect(await runtime.currentCouncillors()).toEqual([]);
  });
});

describe('the elder (#101)', () => {
  const BRIEF: ResearchBrief = {
    task: 'Fix the login redirect',
    files: [{ path: 'src/auth.ts', lines: '10-40', note: 'the redirect' }],
    findings: ['Tests use Vitest.'],
    slices: [],
    councillors: [],
    effort: { level: 'light', reason: 'Small' },
    councillorEfforts: [],
    quickQuest: { recommended: true, reason: 'One function' },
  };
  const tester: CouncillorInfo = {
    id: 'tester',
    skill: 'ibitsa:tester',
    title: 'Tester',
    description: 'Tests',
    source: 'builtin',
    portrait: null,
    model: null,
    tools: ['Read'],
    modes: { planning: true, review: true },
    hash: 'aaa',
  };

  function withElder(options: { repoDir?: string | null; elder?: boolean } = {}) {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir =
      options.repoDir === undefined ? mkdtempSync(join(tmpdir(), 'ibitsa-repo-')) : options.repoDir;
    dirs.push(storageDir, ...(repoDir ? [repoDir] : []));
    const starts: { start: ElderStart; emit: (e: ElderEvent) => void; closed: boolean }[] = [];
    const adapter = new FakeAdapter();
    if (options.elder !== false) {
      Object.assign(adapter, {
        listCouncillors: async () => [tester],
        startElder: (start: ElderStart, emit: (e: ElderEvent) => void) => {
          const s = { start, emit, closed: false };
          starts.push(s);
          return { close: () => (s.closed = true) };
        },
      });
    }
    const gameMaster = new FakeGameMaster();
    const clock = new ManualClock();
    let n = 0;
    const make = () =>
      new Runtime({
        storageDir,
        adapter,
        gameMaster,
        clock,
        newId: () => `camp-${++n}`,
        ...(repoDir ? { repoDir } : {}),
      });
    const runtime = make();
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    const elder = () => {
      const snapshots = received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : []));
      return snapshots.at(-1)?.elder ?? null;
    };
    const settle = async () => {
      await flush();
      clock.advance(SNAPSHOT_INTERVAL_MS);
    };
    return {
      storageDir,
      repoDir,
      adapter,
      runtime,
      connection,
      received,
      starts,
      elder,
      make,
      settle,
    };
  }
  const consult = {
    type: 'consultElder',
    commandId: 'e1',
    task: 'Fix the login redirect',
  } as const;

  it("gives the elder the past campaigns' records and the kept council's campaign (#168)", async () => {
    const env = withElder();
    const folder = join(env.repoDir ?? '', '.ibitsa', 'campaigns', 'camp-old');
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'record.md'),
      '# Campaign record: Sign-in\n\n**Finished.**\n\nEmail sign-in.\n\n## What shipped\n',
    );
    new KeptCouncil(env.storageDir).keep({ sessionId: 'council-old', from: 'Sign-in' });
    env.connection.receive(consult);
    await flush();
    expect(env.starts[0]?.start).toMatchObject({
      pastRecords: [
        {
          campaignId: 'camp-old',
          title: 'Sign-in',
          status: 'finished',
          summary: 'Email sign-in.',
          path: '.ibitsa/campaigns/camp-old/record.md',
        },
      ],
      keptCouncil: { from: 'Sign-in' },
    });
    await env.settle();
    const snapshot = env.received
      .flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : []))
      .at(-1);
    expect(snapshot?.keptCouncil).toEqual({ from: 'Sign-in' });
  });

  it('starts a planning campaign and an elder in the repository with the roster, uncapped (#272)', async () => {
    const env = withElder();
    env.connection.receive(consult);
    await flush();
    expect(logOf(env.storageDir).records.map((r) => r.kind)).toEqual(['gm', 'command']);
    expect(env.starts.map((s) => s.start)).toEqual([
      {
        cwd: env.repoDir,
        task: 'Fix the login redirect',
        councillors: [tester],
        model: 'haiku',
        pastRecords: [],
        keptCouncil: null,
      },
    ]);
  });

  it('logs its events, writes the brief to the campaign folder and closes the session', async () => {
    const env = withElder();
    env.connection.receive(consult);
    await flush();
    const session = env.starts[0];
    session?.emit({ type: 'activity', text: 'Reading src/auth.ts' });
    await env.settle();
    expect(env.elder()).toMatchObject({ status: 'researching', progress: 'Reading src/auth.ts' });
    session?.emit({ type: 'briefSubmitted', brief: BRIEF });
    await env.settle();
    expect(env.elder()).toMatchObject({ status: 'briefed', brief: BRIEF });
    expect(session?.closed).toBe(true);
    const dir = join(env.repoDir ?? '', '.ibitsa', 'campaigns', 'camp-1');
    expect(JSON.parse(readFileSync(join(dir, 'brief.json'), 'utf8'))).toEqual(BRIEF);
    expect(readFileSync(join(dir, 'brief.md'), 'utf8')).toContain(
      '`src/auth.ts:10-40`: the redirect',
    );
    expect(logOf(env.storageDir).records.filter((r) => r.kind === 'elder')).toHaveLength(2);
  });

  it('continues the planning campaign with a quick quest, in the same log', async () => {
    const env = withElder();
    env.connection.receive(consult);
    await flush();
    env.starts[0]?.emit({ type: 'briefSubmitted', brief: BRIEF });
    env.connection.receive(startQuest);
    await flush();
    expect(logOf(env.storageDir).records.filter((r) => r.kind === 'command')).toHaveLength(2);
    expect(env.adapter.sessions[0]?.start.prompt).toContain('- src/auth.ts:10-40: the redirect');
  });

  it('keeps a planning campaign across a reload, starting the cut-short research again (#166)', async () => {
    const env = withElder();
    env.connection.receive(consult);
    await flush();
    env.runtime.dispose();
    const again = env.make();
    again.start();
    const received: CoreMessage[] = [];
    again.connect({ post: (m) => received.push(m) }).receive({ type: 'hello', protocolVersion: 1 });
    const snapshot = received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : [])).at(-1);
    expect(snapshot?.campaign?.status).toBe('planning');
    expect(snapshot?.elder).toMatchObject({ status: 'researching' });
  });

  it('fails the research without a repository or an agent that can research', async () => {
    for (const env of [withElder({ repoDir: null }), withElder({ elder: false })]) {
      env.connection.receive(consult);
      await env.settle();
      expect(env.elder()).toMatchObject({
        status: 'failed',
        error: 'The elder needs a workspace folder and an agent that can research.',
      });
    }
  });

  it("doesn't start a session for research abandoned while the roster was read", async () => {
    const env = withElder();
    env.connection.receive(consult);
    env.connection.receive({ type: 'abandonQuest', commandId: 'a1' });
    await flush();
    expect(env.starts).toEqual([]);
  });
});

/** The smallest plan core accepts (#104). */
const SMALL_PLAN = {
  summary: 'Plan',
  goal: 'Add sign-in',
  tasks: [
    {
      id: 'T1',
      title: 'Do it',
      description: 'Do it.',
      files: [],
      dependsOn: [],
      criteria: [],
      decisions: [],
    },
  ],
  decisions: [],
};

describe('the round table (#103)', () => {
  type Call = {
    start: SittingStart;
    emit: (e: CouncilEvent) => void;
    log: unknown[];
    closed: boolean;
  };
  function withSitting(
    options: { sittings?: boolean; repoDir?: string | null; caps?: SessionCaps } = {},
  ) {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir = options.repoDir === undefined ? '/repo' : options.repoDir;
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(storageDir, home);
    const calls: Call[] = [];
    let disabled: string[] = [];
    const adapter = new FakeAdapter();
    Object.assign(adapter, {
      listCouncillors: async () => [
        {
          id: 'security',
          skill: 'ibitsa:security',
          title: 'Security',
          description: '',
          source: 'builtin',
          portrait: null,
          model: null,
          tools: ['Read'],
          modes: { planning: true, review: true },
          hash: 'a',
        },
      ],
      ...(options.sittings === false
        ? {}
        : {
            startSitting: (start: SittingStart, emit: (e: CouncilEvent) => void) => {
              const call: Call = { start, emit, log: [], closed: false };
              calls.push(call);
              return {
                message: (m: unknown) => call.log.push(['message', m]),
                completeTool: (r: unknown) => call.log.push(['completeTool', r]),
                answer: (r: unknown) => call.log.push(['answer', r]),
                close: () => (call.closed = true),
              };
            },
          }),
    });
    const clock = new ManualClock();
    let n = 0;
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock,
      home,
      newId: () => `camp-${++n}`,
      councilMode: () => 'roundTable',
      watchFolder: () => ({ close: () => {} }),
      ...(repoDir ? { repoDir } : {}),
      disabledCouncillors: () => disabled,
      ...(options.caps ? { caps: () => options.caps as SessionCaps } : {}),
    });
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    const snapshot = () =>
      received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : [])).at(-1);
    const settle = async () => {
      await flush();
      clock.advance(SNAPSHOT_INTERVAL_MS);
    };
    const disable = (ids: string[]) => {
      disabled = ids;
    };
    return { storageDir, runtime, connection, calls, snapshot, settle, disable };
  }
  const convene = {
    type: 'conveneCouncil',
    commandId: 'k1',
    task: 'Add sign-in',
    mode: 'roundTable',
    roster: ['security'],
    effort: 'standard',
  } as const;

  it('keeps a turned-off councillor in the roster but not among those who can sit (#181)', async () => {
    const env = withSitting();
    await env.settle();
    env.disable(['security']);
    env.runtime.refreshCouncillors();
    await env.settle();
    env.connection.receive({ type: 'hello', protocolVersion: 1 });
    expect(env.snapshot()?.councillors).toEqual([]);
    expect(env.snapshot()?.roster?.map((c) => c.id)).toEqual(['security']);
  });

  it('puts the councillors and the council mode in the snapshot', async () => {
    const env = withSitting();
    await env.settle();
    env.connection.receive({ type: 'hello', protocolVersion: 1 });
    expect(env.snapshot()?.councillors?.map((c) => c.id)).toEqual(['security']);
    expect(env.snapshot()?.councilMode).toBe('roundTable');
  });

  it("opens a campaign and a round table on the effort's model, uncapped, and logs what it says", async () => {
    const env = withSitting();
    env.connection.receive(convene);
    await flush();
    expect(env.calls.map((c) => c.start)).toEqual([
      {
        cwd: '/repo',
        mode: 'roundTable',
        task: 'Add sign-in',
        brief: null,
        roster: [{ councillorId: 'security', effort: 'standard' }],
        model: 'sonnet',
      },
    ]);
    const call = env.calls[0];
    call?.emit({ type: 'sessionStarted', sessionId: 'x' });
    call?.emit({
      type: 'reportFiled',
      toolUseId: 'u1',
      councillorId: 'security',
      report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
    });
    expect(call?.log).toEqual([['completeTool', { toolUseId: 'u1', accepted: true }]]);
    call?.emit({
      type: 'questionsAsked',
      toolUseId: 'u2',
      questions: [
        { councillorId: 'security', question: 'Long?', options: [], allowFreeText: true },
      ],
    });
    await env.settle();
    const questions = env.snapshot()?.sitting?.questions;
    const item = questions?.items[0];
    env.connection.receive({
      type: 'askCouncilWhy',
      commandId: 'w',
      batchId: questions?.batchId ?? '',
      questionId: item?.id ?? '',
    });
    env.connection.receive({
      type: 'answerCouncil',
      commandId: 'a',
      batchId: questions?.batchId ?? '',
      answers: { [item?.id ?? '']: { text: 'A week' } },
    });
    expect(call?.log.slice(1).map((l) => (l as [string])[0])).toEqual([
      'completeTool',
      'message',
      'answer',
    ]);
    call?.emit({ type: 'planProposed', toolUseId: 'u3', plan: SMALL_PLAN });
    env.connection.receive({ type: 'dismissCouncil', commandId: 'd' });
    expect(call?.closed).toBe(true);
    expect(logOf(env.storageDir).records.filter((r) => r.kind === 'council').length).toBe(4);
  });

  it('runs separate chambers with a model per councillor (#105)', async () => {
    const env = withSitting();
    env.connection.receive({
      ...convene,
      mode: 'chambers',
      effort: 'light',
      councillorEfforts: { security: 'deep' },
    });
    await flush();
    expect(env.calls[0]?.start).toMatchObject({
      mode: 'chambers',
      model: 'haiku',
      roster: [{ councillorId: 'security', effort: 'deep', model: 'sonnet' }],
    });
  });

  it("caps a sitting at the user's cap, when they set one (#272)", async () => {
    const env = withSitting({
      caps: { sittingMicroUsd: 1_500_000, reviewMicroUsd: null, lessonsMicroUsd: null },
    });
    env.connection.receive(convene);
    await flush();
    expect(env.calls[0]?.start).toMatchObject({ maxBudgetMicroUsd: 1_500_000 });
  });

  it('runs a deep sitting on Opus, with no cap unless the user set one (#272)', async () => {
    const env = withSitting();
    env.connection.receive({ ...convene, effort: 'deep' });
    await flush();
    expect(env.calls[0]?.start).toMatchObject({ model: 'opus' });
    expect(env.calls[0]?.start).not.toHaveProperty('maxBudgetMicroUsd');
  });

  it('fails the sitting without a repository or an agent that can plan', async () => {
    for (const env of [withSitting({ sittings: false }), withSitting({ repoDir: null })]) {
      env.connection.receive(convene);
      await env.settle();
      expect(env.snapshot()?.sitting).toMatchObject({
        status: 'failed',
        error: 'The council needs a workspace folder and an agent that can plan.',
      });
    }
  });
});

describe('the approved plan (#104)', () => {
  it('writes plan.json, plan-v1.json and plan.md to the campaign folder', async () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'ibitsa-repo-'));
    dirs.push(storageDir, repoDir);
    let emit: (e: CouncilEvent) => void = () => {};
    const adapter = Object.assign(new FakeAdapter(), {
      startSitting: (_start: SittingStart, onEvent: (e: CouncilEvent) => void) => {
        emit = onEvent;
        return { message: () => {}, completeTool: () => {}, answer: () => {}, close: () => {} };
      },
    });
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      newId: () => 'camp-1',
      repoDir,
      watchFolder: () => ({ close: () => {} }),
    });
    runtime.start();
    const connection = runtime.connect({ post: () => {} });
    connection.receive({
      type: 'conveneCouncil',
      commandId: 'k',
      task: 'Add sign-in',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'light',
    });
    await flush();
    emit({
      type: 'reportFiled',
      toolUseId: 'r',
      councillorId: 'security',
      report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
    });
    emit({ type: 'planProposed', toolUseId: 'p', plan: SMALL_PLAN });
    connection.receive({ type: 'approvePlan', commandId: 'a', version: 1 });
    const dir = join(repoDir, '.ibitsa', 'campaigns', 'camp-1');
    expect(JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'))).toEqual({
      version: 1,
      ...SMALL_PLAN,
    });
    expect(readFileSync(join(dir, 'plan-v1.json'), 'utf8')).toBe(
      readFileSync(join(dir, 'plan.json'), 'utf8'),
    );
    expect(readFileSync(join(dir, 'plan.md'), 'utf8')).toContain('### T1 · Do it');
    runtime.dispose();
  });
});

describe('council tallies (#106)', () => {
  async function sat() {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const home = mkdtempSync(join(tmpdir(), 'ibitsa-home-'));
    dirs.push(storageDir, home);
    let emit: (e: CouncilEvent) => void = () => {};
    const adapter = Object.assign(new FakeAdapter(), {
      councilPromptVersion: 'prompts-1',
      listCouncillors: async () => [
        {
          id: 'security',
          skill: 'ibitsa:security',
          title: 'Security',
          description: '',
          source: 'builtin',
          portrait: null,
          model: null,
          tools: ['Read'],
          modes: { planning: true, review: true },
          hash: 'h1',
        } satisfies CouncillorInfo,
      ],
      startSitting: (_s: SittingStart, onEvent: (e: CouncilEvent) => void) => {
        emit = onEvent;
        return { message: () => {}, completeTool: () => {}, answer: () => {}, close: () => {} };
      },
    });
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      home,
      newId: () => 'camp-1',
      repoDir: '/repo',
      watchFolder: () => ({ close: () => {} }),
    });
    runtime.start();
    await flush();
    const connection = runtime.connect({ post: () => {} });
    connection.receive({
      type: 'conveneCouncil',
      commandId: 'k',
      task: 'Add sign-in, "fast"',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'light',
    });
    await flush();
    emit({
      type: 'reportFiled',
      toolUseId: 'r',
      councillorId: 'security',
      report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
    });
    emit({ type: 'usage', totalCost: 250_000 });
    emit({ type: 'planProposed', toolUseId: 'p', plan: SMALL_PLAN });
    connection.receive({ type: 'approvePlan', commandId: 'a', version: 1 });
    connection.receive({
      type: 'rateSitting',
      commandId: 'g',
      sittingId: 's1',
      score: 5,
      note: 'Sharp, "useful"',
    });
    return { runtime, storageDir };
  }

  it("notes the council version when the session starts: mode, skill files and the adapter's prompts", async () => {
    const { storageDir } = await sat();
    const noted = logOf(storageDir).records.find(
      (r) => r.kind === 'gm' && r.event.type === 'councilVersionNoted',
    );
    expect(noted?.kind === 'gm' && noted.event).toEqual({
      type: 'councilVersionNoted',
      sittingId: 's1',
      version: councilVersion({
        mode: 'roundTable',
        councillors: [{ id: 'security', hash: 'h1' }],
        promptVersion: 'prompts-1',
      }),
    });
  });

  it('exports every sitting with its campaign, as JSON and as CSV', async () => {
    const { runtime } = await sat();
    const json = JSON.parse(runtime.exportTallies('json'));
    expect(json).toMatchObject([
      {
        campaignId: 'camp-1',
        campaignTitle: 'Add sign-in, "fast"',
        sittingId: 's1',
        outcome: 'approved',
        cost: { totalMicroUsd: 250_000 },
        rating: { score: 5, note: 'Sharp, "useful"' },
        convenedAt: '2026-10-04T15:00:00.000Z',
      },
    ]);
    const [header, row, ...rest] = runtime.exportTallies('csv').trimEnd().split('\n');
    expect(rest).toEqual([]);
    expect(
      header?.startsWith('campaignId,campaignTitle,sittingId,convenedAt,mode,councilVersion'),
    ).toBe(true);
    expect(row).toContain('camp-1,"Add sign-in, ""fast""",s1,2026-10-04T15:00:00.000Z,roundTable,');
    expect(row).toContain(
      ',0.25,0,0,0,0,,light,,security:light,,1,0,0,0,0,0,0,0,1,1,0,0,5,"Sharp, ""useful"""',
    );
    runtime.dispose();
  });

  it('exports nothing without sittings, and skips unreadable logs', () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    dirs.push(storageDir);
    mkdirSync(join(storageDir, 'campaigns', 'broken'), { recursive: true });
    appendFileSync(join(storageDir, 'campaigns', 'broken', 'events.jsonl'), 'not json\n');
    const runtime = new Runtime({
      storageDir,
      adapter: new FakeAdapter(),
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
    });
    expect(JSON.parse(runtime.exportTallies('json'))).toEqual([]);
    expect(runtime.exportTallies('csv').split('\n')[1]).toBe('');
  });
});

describe('rebasing a stacked island (#121)', () => {
  it("asks the game master to rebase and logs the outcome; does nothing when it can't", async () => {
    const env = await arrived();
    const calls: unknown[] = [];
    Object.assign(env.gameMaster, {
      rebaseWorktree: async (r: unknown) => {
        calls.push(r);
        return 'conflict' as const;
      },
    });
    const perform = (env.runtime as unknown as { perform(e: unknown): void }).perform.bind(
      env.runtime,
    );
    perform({ type: 'rebaseWorktree', islandId: 'i2', worktreePath: '/wt/x', onto: 'ibitsa/a' });
    await flush();
    expect(calls).toEqual([{ worktreePath: '/wt/x', onto: 'ibitsa/a' }]);
    const rebased = logOf(env.storageDir).records.find(
      (r) => r.kind === 'gm' && r.event.type === 'worktreeRebased',
    );
    expect(rebased?.kind === 'gm' && rebased.event).toEqual({
      type: 'worktreeRebased',
      islandId: 'i2',
      outcome: 'conflict',
    });
    Object.assign(env.gameMaster, {
      rebaseWorktree: async () => Promise.reject(new Error('git broke')),
    });
    perform({ type: 'rebaseWorktree', islandId: 'i2', worktreePath: '/wt/x', onto: 'ibitsa/a' });
    await flush();
    const plain = setup();
    (plain.runtime as unknown as { perform(e: unknown): void }).perform({
      type: 'rebaseWorktree',
      islandId: 'i2',
      worktreePath: '/wt/x',
      onto: 'ibitsa/a',
    });
  });
});

describe('the review loop (M5, #136)', () => {
  it('turns reviews on only when the game master can run checks and the agent can review', async () => {
    const plain = await arrived();
    const settingsOf = (dir: string) =>
      logOf(dir).records.find((r) => r.kind === 'gm' && r.event.type === 'questSettings');
    const off = settingsOf(plain.storageDir);
    expect(off?.kind === 'gm' && off.event.type === 'questSettings' && off.event.reviews).toBe(
      false,
    );
    const able = setup();
    Object.assign(able.gameMaster, { runChecks: async () => [] });
    Object.assign(able.adapter, {
      startReview: () => ({ completeTool: () => {}, close: () => {} }),
    });
    able.connection.receive(startQuest);
    await flush();
    const on = settingsOf(able.storageDir);
    expect(on?.kind === 'gm' && on.event.type === 'questSettings' && on.event).toMatchObject({
      reviews: true,
      loopLimit: 3,
    });
  });

  it('runs checks, starts reviewers with their diff and model, and passes their verdicts on', async () => {
    const env = await arrived();
    const runs: unknown[] = [];
    const starts: ReviewStart[] = [];
    const log: unknown[] = [];
    let emit: (e: ReviewEvent) => void = () => {};
    Object.assign(env.gameMaster, {
      runChecks: async (r: unknown) => {
        runs.push(r);
        return [{ command: 'pnpm test', ok: true, output: 'ok' }];
      },
      taskDiff: async () => 'diff --git a/x b/x',
    });
    Object.assign(env.adapter, {
      startReview: (start: ReviewStart, onEvent: (e: ReviewEvent) => void) => {
        starts.push(start);
        emit = onEvent;
        return {
          completeTool: (r: unknown) => log.push(['complete', r]),
          close: () => log.push(['close']),
        };
      },
    });
    const perform = (env.runtime as unknown as { perform(e: unknown): void }).perform.bind(
      env.runtime,
    );
    perform({ type: 'runChecks', taskPointId: 't3', worktreePath: '/wt/x' });
    await flush();
    expect(runs).toEqual([{ worktreePath: '/wt/x' }]);
    const checks = logOf(env.storageDir).records.find(
      (r) => r.kind === 'gm' && r.event.type === 'checksRan',
    );
    expect(checks?.kind === 'gm' && checks.event).toMatchObject({
      taskPointId: 't3',
      results: [{ ok: true }],
    });
    perform({
      type: 'startReview',
      reviewId: 'r9',
      taskPointId: 't3',
      councillorId: 'security',
      effort: 'standard',
      round: 1,
      worktreePath: '/wt/x',
      from: 'main',
      to: 'abc',
      since: null,
      task: { title: 'T', description: 'D' },
      criteria: ['Hashed'],
      decisions: [],
      checks: [],
    });
    await flush();
    expect(starts[0]).toMatchObject({
      cwd: '/wt/x',
      model: 'sonnet',
      diff: 'diff --git a/x b/x',
      criteria: ['Hashed'],
    });
    emit({ type: 'usage', totalCost: 5 });
    expect(
      logOf(env.storageDir).records.some((r) => r.kind === 'review' && r.reviewId === 'r9'),
    ).toBe(true);
    perform({
      type: 'completeReviewTool',
      reviewId: 'r9',
      toolUseId: 'v',
      accepted: false,
      reason: 'no',
    });
    perform({ type: 'closeReview', reviewId: 'r9' });
    expect(log).toEqual([
      ['complete', { toolUseId: 'v', accepted: false, reason: 'no' }],
      ['close'],
    ]);
  });

  it('reports no checks and a failed review when the game master or the agent cannot', async () => {
    const env = await arrived();
    const perform = (env.runtime as unknown as { perform(e: unknown): void }).perform.bind(
      env.runtime,
    );
    perform({ type: 'runChecks', taskPointId: 't3', worktreePath: '/wt/x' });
    perform({
      type: 'startReview',
      reviewId: 'r1',
      taskPointId: 't3',
      councillorId: 'x',
      effort: 'light',
      round: 1,
      worktreePath: '/wt',
      from: 'main',
      to: null,
      since: null,
      task: { title: 'T', description: 'D' },
      criteria: [],
      decisions: [],
      checks: [],
    });
    await flush();
    const records = logOf(env.storageDir).records;
    expect(records.find((r) => r.kind === 'gm' && r.event.type === 'checksRan')).toMatchObject({
      event: { results: [] },
    });
    expect(records.find((r) => r.kind === 'review')).toMatchObject({
      event: { type: 'error', message: 'This agent cannot review.' },
    });
    Object.assign(env.gameMaster, { runChecks: async () => Promise.reject(new Error('boom')) });
    perform({ type: 'runChecks', taskPointId: 't3', worktreePath: '/wt/x' });
    await flush();
    const failed = logOf(env.storageDir)
      .records.filter((r) => r.kind === 'gm' && r.event.type === 'checksRan')
      .at(-1);
    expect(failed).toMatchObject({ event: { results: [{ command: 'checks', ok: false }] } });
  });
});

describe('the campaign record and the council context (#167)', () => {
  function councilRuntime() {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'ibitsa-repo-'));
    dirs.push(storageDir, repoDir);
    const starts: SittingStart[] = [];
    let emit: (e: CouncilEvent) => void = () => {};
    const adapter = Object.assign(new FakeAdapter(), {
      startSitting: (start: SittingStart, onEvent: (e: CouncilEvent) => void) => {
        starts.push(start);
        emit = onEvent;
        return { message: () => {}, completeTool: () => {}, answer: () => {}, close: () => {} };
      },
    });
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      newId: () => 'camp-1',
      repoDir,
      watchFolder: () => ({ close: () => {} }),
    });
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    const convene = (extra: { freshCouncil?: boolean } = {}) =>
      connection.receive({
        type: 'conveneCouncil',
        commandId: 'k',
        task: 'Add sign-in',
        mode: 'roundTable',
        roster: ['security'],
        effort: 'light',
        ...extra,
      });
    return {
      storageDir,
      repoDir,
      runtime,
      connection,
      starts,
      convene,
      emit: (e: CouncilEvent) => emit(e),
    };
  }

  it("resumes the council's kept session in the next campaign's first sitting, once", async () => {
    const { storageDir, runtime, starts, convene } = councilRuntime();
    new KeptCouncil(storageDir).keep({ sessionId: 'council-old', from: 'Sign-in' });
    convene();
    await flush();
    expect(starts[0]?.resume).toEqual({ sessionId: 'council-old', kept: true });
    expect(new KeptCouncil(storageDir).peek()).toBeNull();
    runtime.dispose();
  });

  it('starts fresh when asked to, forgetting the kept council (#168)', async () => {
    const { storageDir, runtime, starts, convene } = councilRuntime();
    new KeptCouncil(storageDir).keep({ sessionId: 'council-old', from: 'Sign-in' });
    convene({ freshCouncil: true });
    await flush();
    expect(starts[0]).not.toHaveProperty('resume');
    expect(new KeptCouncil(storageDir).peek()).toBeNull();
    runtime.dispose();
  });

  it('writes record.md when the campaign is abandoned, and forgets a kept council', async () => {
    const { storageDir, repoDir, runtime, connection, convene, emit } = councilRuntime();
    convene();
    await flush();
    emit({ type: 'sessionStarted', sessionId: 'council-1' });
    new KeptCouncil(storageDir).keep({ sessionId: 'council-older', from: 'Sign-in' });
    connection.receive({ type: 'abandonQuest', commandId: 'a' });
    await flush();
    const md = readFileSync(join(repoDir, '.ibitsa', 'campaigns', 'camp-1', 'record.md'), 'utf8');
    expect(md).toContain('# Campaign record: Add sign-in');
    expect(md).toContain('**Abandoned.**');
    expect(runtime.snapshotState.campaign?.ending).toMatchObject({
      record: 'written',
      recordPath: '.ibitsa/campaigns/camp-1/record.md',
    });
    expect(new KeptCouncil(storageDir).peek()).toBeNull();
    runtime.dispose();
  });
});

describe('hero classes (#182)', () => {
  it("starts a hero on its class's model, and puts the classes and recolors in the snapshot", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    dirs.push(storageDir);
    const adapter = new FakeAdapter();
    const runtime = new Runtime({
      storageDir,
      adapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      classes: () => resolveClasses({ ranger: { model: 'opus' } }),
      recolor: () => ({ 'class:ranger': { hue: 90, preset: 'none' } }),
    });
    runtime.start();
    const received: CoreMessage[] = [];
    const connection = runtime.connect({ post: (m) => received.push(m) });
    connection.receive(startQuest);
    await flush();
    expect(adapter.sessions[0]?.start.model).toBe('opus');
    connection.receive({ type: 'hello', protocolVersion: 1 });
    const snapshot = received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : [])).at(-1);
    expect(snapshot?.classes?.find((c) => c.id === 'ranger')?.model).toBe('opus');
    expect(snapshot?.recolor).toEqual({ 'class:ranger': { hue: 90, preset: 'none' } });
    runtime.dispose();
  });

  it("marks a class whose ACP agent runs without Ibitsa's sandbox (#200)", async () => {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    dirs.push(storageDir);
    const asked: string[] = [];
    const runtime = new Runtime({
      storageDir,
      adapter: new FakeAdapter(),
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      classes: () => resolveClasses({ seer: { agent: 'codex' }, oracle: { agent: 'opencode' } }),
      agentSandboxed: (id) => {
        asked.push(id);
        return id === 'codex';
      },
    });
    runtime.start();
    const received: CoreMessage[] = [];
    runtime
      .connect({ post: (m) => received.push(m) })
      .receive({ type: 'hello', protocolVersion: 1 });
    const snapshot = received.flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : [])).at(-1);
    const sandboxed = (id: string) => snapshot?.classes?.find((c) => c.id === id)?.sandboxed;
    expect(sandboxed('oracle')).toBe(false);
    expect(snapshot?.classes?.find((c) => c.id === 'seer')).not.toHaveProperty('sandboxed');
    // Claude's classes follow the platform (`Snapshot.sandboxed`), not this.
    expect(snapshot?.classes?.find((c) => c.id === 'ranger')).not.toHaveProperty('sandboxed');
    expect(asked).not.toContain('claude');
    runtime.dispose();
  });

  it('runs the built-ins without settings, and names no model for an unknown class', async () => {
    const env = setup();
    env.connection.receive({ ...startQuest, classId: 'bard' });
    await flush();
    expect(env.adapter.sessions[0]?.start).not.toHaveProperty('model');
    env.connection.receive({ type: 'hello', protocolVersion: 1 });
    const snapshot = env.received
      .flatMap((m) => (m.type === 'snapshot' ? [m.snapshot] : []))
      .at(-1);
    expect(snapshot?.classes?.map((c) => c.id)).toEqual([
      'paladin',
      'barbarian',
      'ranger',
      'rogue',
    ]);
    expect(snapshot?.recolor).toEqual({});
  });
});

describe("a class's agent (§11.5, #198)", () => {
  /** A runtime whose classes run on Claude or on ACP agents, and a two-task plan to start. */
  function mixed(agentAdapter: (id: string) => AgentAdapter | { error: string } | undefined) {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'ibitsa-repo-'));
    dirs.push(storageDir, repoDir);
    let emit: (e: CouncilEvent) => void = () => {};
    const claude = Object.assign(new FakeAdapter(), {
      startSitting: (_s: SittingStart, onEvent: (e: CouncilEvent) => void) => {
        emit = onEvent;
        return { message: () => {}, completeTool: () => {}, answer: () => {}, close: () => {} };
      },
    });
    const runtime = new Runtime({
      storageDir,
      adapter: claude,
      agentAdapter,
      gameMaster: new FakeGameMaster(),
      clock: new ManualClock(),
      newId: () => 'camp-1',
      repoDir,
      watchFolder: () => ({ close: () => {} }),
      classes: () => resolveClasses({ seer: { agent: 'codex' }, oracle: { agent: 'nowhere' } }),
    });
    runtime.start();
    const connection = runtime.connect({ post: () => {} });
    const plan = async () => {
      connection.receive({
        type: 'conveneCouncil',
        commandId: 'k',
        task: 'Add sign-in',
        mode: 'roundTable',
        roster: ['security'],
        effort: 'light',
      });
      await flush();
      emit({
        type: 'reportFiled',
        toolUseId: 'r',
        councillorId: 'security',
        report: { concerns: [], questions: [], recommendations: [], notChecked: [] },
      });
      const second = {
        id: 'T2',
        title: 'Do more',
        description: 'More.',
        files: [],
        dependsOn: [],
        criteria: [],
        decisions: [],
      };
      emit({
        type: 'planProposed',
        toolUseId: 'p',
        plan: {
          ...SMALL_PLAN,
          tasks: [...SMALL_PLAN.tasks, second],
          islands: [
            { id: 'I1', title: 'One', tasks: ['T1'] },
            { id: 'I2', title: 'Two', tasks: ['T2'] },
          ],
        },
      });
      connection.receive({ type: 'approvePlan', commandId: 'a', version: 1 });
      await flush();
      return ['I1', 'I2'];
    };
    const start = (parties: { heroName: string; classId: string }[], islands: string[]) =>
      connection.receive({
        type: 'startCampaign',
        commandId: 'go',
        baseRef: 'main',
        parties: parties.map((p, i) => ({ ...p, islandId: islands[i] ?? '' })),
      });
    return { runtime, claude, plan, start };
  }

  it("starts each hero on its class's agent, so a party mixes Claude and an ACP agent", async () => {
    const acp = new FakeAdapter();
    const asked: string[] = [];
    const { runtime, claude, plan, start } = mixed((id) => {
      asked.push(id);
      return id === 'codex' ? acp : undefined;
    });
    start(
      [
        { heroName: 'Ilse', classId: 'ranger' },
        { heroName: 'Mira', classId: 'seer' },
      ],
      await plan(),
    );
    await flush();
    await flush();
    expect(claude.sessions.map((s) => s.start.classId)).toEqual(['ranger']);
    expect(acp.sessions.map((s) => s.start.classId)).toEqual(['seer']);
    // The seer names no model, so the agent runs on its own default.
    expect(acp.sessions[0]?.start).not.toHaveProperty('model');
    expect(claude.sessions[0]?.start.model).toBe('sonnet');
    expect(asked).toEqual(['codex']);
    runtime.dispose();
  });

  it("gives the hero an error naming an agent that isn't there or can't be used", async () => {
    const { runtime, claude, plan, start } = mixed((id) =>
      id === 'codex'
        ? { error: "Claude runs only through Ibitsa's own Claude adapter." }
        : undefined,
    );
    start(
      [
        { heroName: 'Mira', classId: 'seer' },
        { heroName: 'Odo', classId: 'oracle' },
      ],
      await plan(),
    );
    await flush();
    await flush();
    const errors = runtime.snapshotState.needsYou.flatMap((n) =>
      n.kind === 'error' ? [n.message] : [],
    );
    expect(errors).toEqual([
      "Claude runs only through Ibitsa's own Claude adapter.",
      'No agent "nowhere" in ibitsa.agents.',
    ]);
    expect(claude.sessions).toEqual([]);
    runtime.dispose();
  });
});

describe("a councillor's agent for reviews (§5.5, #201)", () => {
  const base: CouncillorInfo = {
    id: 'security',
    skill: 'ibitsa:security',
    title: 'Security',
    description: 'Security',
    source: 'builtin',
    portrait: null,
    model: null,
    tools: ['Read'],
    modes: { planning: true, review: true },
    hash: 'aaa',
  };
  const startReview = (councillorId: string) => ({
    type: 'startReview',
    reviewId: `r-${councillorId}`,
    taskPointId: 't3',
    councillorId,
    effort: 'standard',
    round: 1,
    worktreePath: '/wt/x',
    from: 'main',
    to: 'abc',
    since: null,
    task: { title: 'T', description: 'D' },
    criteria: ['Hashed'],
    decisions: [],
    checks: [],
  });

  /** A reviewing adapter that records what it was asked to review. */
  function reviewer() {
    const starts: ReviewStart[] = [];
    return {
      starts,
      startReview: (start: ReviewStart) => {
        starts.push(start);
        return { completeTool: () => {}, close: () => {} };
      },
    };
  }

  async function withCouncillors(councillors: CouncillorInfo[]) {
    const storageDir = mkdtempSync(join(tmpdir(), 'ibitsa-runtime-'));
    const repoDir = mkdtempSync(join(tmpdir(), 'ibitsa-repo-'));
    dirs.push(storageDir, repoDir);
    const claudeReviews = reviewer();
    const acpReviews = reviewer();
    const guidanceAsked: unknown[] = [];
    const claude = Object.assign(new FakeAdapter(), {
      listCouncillors: async () => councillors,
      startReview: claudeReviews.startReview,
      reviewGuidance: (request: { cwd: string; councillorId: string }) => {
        guidanceAsked.push(request);
        return { title: 'Security', guidance: 'Look for injection.' };
      },
    });
    const codex = Object.assign(new FakeAdapter(), { startReview: acpReviews.startReview });
    const runtime = new Runtime({
      storageDir,
      adapter: claude,
      agentAdapter: (id) =>
        id === 'codex' ? codex : id === 'refused' ? { error: 'Not this one.' } : undefined,
      gameMaster: Object.assign(new FakeGameMaster(), { taskDiff: async () => 'diff' }),
      clock: new ManualClock(),
      newId: () => 'camp-1',
      repoDir,
      watchFolder: () => ({ close: () => {} }),
    });
    runtime.start();
    const connection = runtime.connect({ post: () => {} });
    connection.receive(startQuest);
    await flush();
    const perform = (runtime as unknown as { perform(e: unknown): void }).perform.bind(runtime);
    const reviewErrors = () =>
      logOf(storageDir).records.flatMap((r) =>
        r.kind === 'review' && r.event.type === 'error' ? [r.event.message] : [],
      );
    return { runtime, perform, claudeReviews, acpReviews, guidanceAsked, reviewErrors };
  }

  it("reviews on the councillor's ACP agent, briefed with Claude's guidance, on the agent's model", async () => {
    const env = await withCouncillors([
      { ...base, agent: 'codex' },
      { ...base, id: 'tester', title: 'Tester' },
    ]);
    env.perform(startReview('security'));
    env.perform(startReview('tester'));
    await flush();
    // A Claude hero's work, reviewed by another vendor's model: a second opinion.
    expect(env.acpReviews.starts).toEqual([
      expect.objectContaining({
        councillorId: 'security',
        cwd: '/wt/x',
        model: '',
        diff: 'diff',
        guidance: { title: 'Security', guidance: 'Look for injection.' },
      }),
    ]);
    expect(env.guidanceAsked).toEqual([{ cwd: '/wt/x', councillorId: 'security' }]);
    // A councillor on Claude reviews as before: the effort's model, its adapter's own guidance.
    expect(env.claudeReviews.starts).toEqual([
      expect.objectContaining({ councillorId: 'tester', model: 'sonnet' }),
    ]);
    expect(env.claudeReviews.starts[0]).not.toHaveProperty('guidance');
    env.runtime.dispose();
  });

  it("keeps the councillor's own model on its agent", async () => {
    const env = await withCouncillors([{ ...base, agent: 'codex', model: 'gpt-6-luna' }]);
    env.perform(startReview('security'));
    await flush();
    expect(env.acpReviews.starts[0]?.model).toBe('gpt-6-luna');
    env.runtime.dispose();
  });

  it('fails the review when its agent is unknown or refused', async () => {
    const env = await withCouncillors([
      { ...base, agent: 'nowhere' },
      { ...base, id: 'tester', agent: 'refused' },
    ]);
    env.perform(startReview('security'));
    env.perform(startReview('tester'));
    await flush();
    expect(env.reviewErrors()).toEqual(['No agent "nowhere" in ibitsa.agents.', 'Not this one.']);
    expect(env.acpReviews.starts).toEqual([]);
    expect(env.claudeReviews.starts).toEqual([]);
    env.runtime.dispose();
  });
});
