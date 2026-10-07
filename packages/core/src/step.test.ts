import type { AgentEvent, Command, Cue, HeroView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import { Hero, SILENCE_MS } from './hero';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { describePermission, NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { Quest } from './quest';
import { initialState } from './state';
import type { CoreState, HeroRecord } from './state.types';
import { step } from './step';
import { view } from './view';

const sumGold = (golds: HeroRecord['gold'][]) =>
  Quest.totalGold(golds.map((gold) => ({ gold }) as HeroRecord));

function executionState(record: HeroRecord, state: CoreState) {
  const outbox = new Outbox();
  const ctx = { state, outbox, needsYou: new NeedsYou({ state, outbox }), t: 0 };
  return new Hero({ record, ctx }).executionState();
}

/** Feeds inputs in order, collecting every cue and effect. */
class Harness {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  t = 0;

  input(input: CoreInput): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    return this;
  }
  command(command: Command, t = this.t) {
    this.t = t;
    return this.input({ kind: 'command', t, command });
  }
  gm(event: GameMasterEvent, t = this.t) {
    this.t = t;
    return this.input({ kind: 'gm', t, event });
  }
  agent(event: AgentEvent, t = this.t) {
    this.t = t;
    return this.input({ kind: 'agent', t, heroId: 'h4', event });
  }
  timer(timerId: string, t: number) {
    this.t = t;
    return this.input({ kind: 'timer', t, timerId });
  }
  hero(): HeroView {
    const hero = view(this.state).heroes[0];
    if (!hero) throw new Error('no hero');
    return hero;
  }
  drain(): { cues: Cue[]; effects: Effect[] } {
    const out = { cues: this.cues, effects: this.effects };
    this.cues = [];
    this.effects = [];
    return out;
  }
}

const startQuest: Command = {
  type: 'startQuest',
  commandId: 'c-start',
  description: 'Fix the login redirect\nIt loops after logout.',
  heroName: 'Ranger Ilse',
  classId: 'ranger',
  baseRef: 'main',
};

/** A quest whose hero has arrived and is working on its prompt. */
function arrived(): Harness {
  return new Harness()
    .command(startQuest)
    .gm({
      type: 'worktreeCreated',
      islandId: 'i2',
      path: '/repo.ibitsa/ibitsa/fix-login',
      branch: 'ibitsa/fix-the-login-redirect',
    })
    .agent({ type: 'sessionStarted', sessionId: 's1' }, 1_000);
}

describe('starting a quest', () => {
  it('creates the campaign, island, task point and a traveling hero, and asks for a worktree', () => {
    const h = new Harness().command(startQuest);
    const snap = view(h.state);
    expect(snap.campaign).toEqual({
      id: 'c1',
      title: 'Fix the login redirect',
      status: 'active',
      gold: { kind: 'unknown' },
      autoApprove: false,
      branching: 'separate',
      stackedStart: null,
      capMicroUsd: null,
      maxParallel: 2,
    });
    expect(snap.islands).toEqual([
      {
        basedOn: null,
        behind: false,
        id: 'i2',
        name: 'Fix the login redirect',
        branch: 'ibitsa/fix-the-login-redirect',
        worktree: 'creating',
        taskPoints: [{ id: 't3', title: 'Fix the login redirect', state: 'active' }],
      },
    ]);
    expect(h.hero()).toMatchObject({
      id: 'h4',
      name: 'Ranger Ilse',
      classId: 'ranger',
      state: { kind: 'traveling' },
      activity: null,
      hp: { kind: 'unknown' },
      gold: { kind: 'unknown' },
    });
    expect(h.effects).toEqual([
      {
        type: 'createWorktree',
        islandId: 'i2',
        branch: 'ibitsa/fix-the-login-redirect',
        baseRef: 'main',
      },
    ]);
  });

  it('truncates long titles', () => {
    const h = new Harness().command({ ...startQuest, description: 'x'.repeat(80) });
    expect(view(h.state).campaign?.title).toBe(`${'x'.repeat(59)}…`);
  });

  it('allows one quest at a time', () => {
    const h = new Harness().command(startQuest).command({ ...startQuest, commandId: 'c-again' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'c-again',
      reason: 'Finish or abandon the current quest first.',
    });
  });

  it('starts the session in the new worktree with the task text', () => {
    const h = new Harness().command(startQuest);
    h.drain();
    h.gm({ type: 'worktreeCreated', islandId: 'i2', path: '/wt', branch: 'ibitsa/fix-2' });
    expect(h.effects).toContainEqual({
      type: 'startSession',
      heroId: 'h4',
      cwd: '/wt',
      classId: 'ranger',
      prompt: startQuest.type === 'startQuest' ? startQuest.description : '',
    });
    expect(view(h.state).islands[0]?.branch).toBe('ibitsa/fix-2');
    expect(h.hero().state).toEqual({ kind: 'traveling' });
  });

  it('puts the hero in error when the worktree cannot be created', () => {
    const h = new Harness()
      .command(startQuest)
      .gm({ type: 'worktreeFailed', islandId: 'i2', message: 'branch exists' });
    expect(h.hero().state).toEqual({
      kind: 'error',
      message: 'Could not create the worktree: branch exists',
    });
  });
});

describe('working', () => {
  it('ends traveling when the session starts, then thinks', () => {
    expect(arrived().hero()).toMatchObject({
      state: { kind: 'working' },
      activity: { kind: 'think' },
    });
  });

  it('shows the running tool, and emits activityFinished with its outcome', () => {
    const h = arrived().agent({
      type: 'activityStarted',
      toolUseId: 'u1',
      kind: 'test',
      detail: 'pnpm test',
    });
    expect(h.hero().activity).toEqual({ kind: 'test', detail: 'pnpm test' });
    h.drain();
    h.agent({ type: 'activityFinished', toolUseId: 'u1', outcome: 'failed' });
    expect(h.cues).toEqual([
      { type: 'activityFinished', heroId: 'h4', kind: 'test', outcome: 'failed' },
    ]);
    expect(h.hero()).toMatchObject({ state: { kind: 'working' }, activity: { kind: 'think' } });
  });

  it('becomes idle with a reply item when a turn ends without submit_task', () => {
    const h = arrived()
      .agent({ type: 'message', text: 'Should I also update the docs?' })
      .agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(h.hero().state).toEqual({ kind: 'idle' });
    expect(view(h.state).needsYou).toEqual([
      { kind: 'reply', id: 'n5', heroId: 'h4', text: 'Should I also update the docs?' },
    ]);
  });

  it('stays working when another turn is queued', () => {
    const h = arrived().agent({ type: 'turnEnded', queuedTurns: 1 });
    expect(h.hero().state).toEqual({ kind: 'working' });
  });

  it('answers a reply with sendMessage, which clears the item', () => {
    const h = arrived().agent({ type: 'turnEnded', queuedTurns: 0 });
    h.drain();
    h.command({
      type: 'sendMessage',
      commandId: 'c1',
      heroId: 'h4',
      text: 'Yes, the README too.',
      priority: 'next',
    });
    expect(view(h.state).needsYou).toEqual([]);
    expect(h.effects).toContainEqual({
      type: 'sendMessage',
      heroId: 'h4',
      text: 'Yes, the README too.',
      priority: 'next',
    });
  });

  it('counts queued messages sent mid-turn', () => {
    const h = arrived().command({
      type: 'sendMessage',
      commandId: 'c1',
      heroId: 'h4',
      text: 'also check the tests',
      priority: 'next',
    });
    expect(h.hero().queuedMessages).toBe(1);
    h.agent({ type: 'turnStarted' });
    expect(h.hero().queuedMessages).toBe(0);
  });

  it('stops the hero with an interrupt', () => {
    const h = arrived();
    h.drain();
    h.command({ type: 'stopHero', commandId: 'c1', heroId: 'h4' });
    expect(h.effects[0]).toEqual({ type: 'interrupt', heroId: 'h4' });
  });
});

describe('needs you', () => {
  it('turns a permission request into an exact item and waits on you, even with a tool running', () => {
    const h = arrived()
      .agent({ type: 'activityStarted', toolUseId: 'u1', kind: 'read' })
      .agent({
        type: 'permission',
        requestId: 'r1',
        tool: 'Bash',
        input: { command: 'rm -rf node_modules' },
      });
    expect(h.hero().state).toEqual({ kind: 'waitingOnYou' });
    expect(view(h.state).needsYou).toEqual([
      {
        kind: 'permission',
        id: 'n5',
        heroId: 'h4',
        action: 'Run command',
        target: 'rm -rf node_modules',
        cwd: '/repo.ibitsa/ibitsa/fix-login',
        alwaysAllow: [],
      },
    ]);
    expect(h.cues).toContainEqual({ type: 'needsYouAdded', itemId: 'n5' });
  });

  it('forwards the answer to the adapter and goes back to work', () => {
    const h = arrived().agent({ type: 'permission', requestId: 'r1', tool: 'Bash', input: {} });
    h.drain();
    h.command({
      type: 'answerPermission',
      commandId: 'c1',
      itemId: 'n5',
      decision: 'deny',
      note: 'not now',
    });
    expect(h.effects).toContainEqual({
      type: 'answerPermission',
      heroId: 'h4',
      requestId: 'r1',
      decision: 'deny',
      note: 'not now',
    });
    expect(view(h.state).needsYou).toEqual([]);
    expect(h.hero().state).toEqual({ kind: 'working' });
  });

  it('rejects an answer to a request that is no longer waiting', () => {
    const h = arrived().command({
      type: 'answerPermission',
      commandId: 'c1',
      itemId: 'n99',
      decision: 'allow',
    });
    expect(h.cues).toEqual([
      { type: 'commandRejected', commandId: 'c1', reason: 'That request is no longer waiting.' },
    ]);
  });

  it('handles questions the same way', () => {
    const questions = [
      {
        question: 'Which database?',
        header: 'Database',
        options: [
          { label: 'Postgres', description: 'What prod runs' },
          { label: 'SQLite', description: 'Simpler' },
        ],
        multiSelect: false,
      },
    ];
    const h = arrived().agent({ type: 'question', requestId: 'r2', questions });
    expect(view(h.state).needsYou).toEqual([
      { kind: 'question', id: 'n5', heroId: 'h4', questions },
    ]);
    h.drain();
    h.command({
      type: 'answerQuestion',
      commandId: 'c1',
      itemId: 'n5',
      answers: { 'Which database?': 'Postgres' },
    });
    expect(h.effects).toContainEqual({
      type: 'answerQuestion',
      heroId: 'h4',
      requestId: 'r2',
      answers: { 'Which database?': 'Postgres' },
    });
  });
});

describe('submitting', () => {
  const submitted = () =>
    arrived()
      .agent({ type: 'activityStarted', toolUseId: 'u9', kind: 'other' })
      .agent({ type: 'taskSubmitted', toolUseId: 'u9', summary: 'Fixed the redirect loop.' });

  it('asks for the submit check', () => {
    expect(submitted().effects).toContainEqual({
      type: 'checkSubmit',
      heroId: 'h4',
      toolUseId: 'u9',
    });
  });

  it('accepts a passing check, and shows submitted once the turn ends', () => {
    const h = submitted().gm({ type: 'submitChecked', heroId: 'h4', toolUseId: 'u9', ok: true });
    expect(h.effects).toContainEqual({
      type: 'completeSubmit',
      heroId: 'h4',
      toolUseId: 'u9',
      accepted: true,
    });
    expect(h.hero().state).toEqual({ kind: 'working' });
    h.agent({ type: 'activityFinished', toolUseId: 'u9', outcome: 'ok' }).agent({
      type: 'turnEnded',
      queuedTurns: 0,
    });
    expect(h.hero().state).toEqual({ kind: 'submitted', summary: 'Fixed the redirect loop.' });
    expect(view(h.state).islands[0]?.taskPoints[0]?.state).toBe('doneUnreviewed');
    expect(view(h.state).needsYou).toEqual([]);
  });

  it('rejects the tool call when the check fails', () => {
    const h = submitted().gm({
      type: 'submitChecked',
      heroId: 'h4',
      toolUseId: 'u9',
      ok: false,
      reason: 'Commit your changes first.',
    });
    expect(h.effects).toContainEqual({
      type: 'completeSubmit',
      heroId: 'h4',
      toolUseId: 'u9',
      accepted: false,
      reason: 'Commit your changes first.',
    });
    h.agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(h.hero().state).toEqual({ kind: 'idle' });
    expect(view(h.state).islands[0]?.taskPoints[0]?.state).toBe('active');
  });

  it('lets the user mark the task done when the hero is idle', () => {
    const h = arrived()
      .agent({ type: 'turnEnded', queuedTurns: 0 })
      .command({ type: 'markDone', commandId: 'c1', heroId: 'h4' });
    expect(h.hero().state).toEqual({ kind: 'submitted', summary: '' });
    expect(view(h.state).needsYou).toEqual([]);
  });

  it('finishes the quest only after submit, closing the session', () => {
    const h = arrived().command({ type: 'finishQuest', commandId: 'c1' });
    expect(h.cues).toContainEqual({
      type: 'commandRejected',
      commandId: 'c1',
      reason: 'The task has not been submitted yet.',
    });
    h.agent({ type: 'turnEnded', queuedTurns: 0 })
      .command({ type: 'markDone', commandId: 'c2', heroId: 'h4' })
      .command({ type: 'finishQuest', commandId: 'c3' });
    expect(view(h.state).campaign?.status).toBe('finished');
    expect(h.effects).toContainEqual({ type: 'closeSession', heroId: 'h4' });
  });

  it('abandons the quest from any state', () => {
    const h = arrived().command({ type: 'abandonQuest', commandId: 'c1' });
    expect(view(h.state).campaign?.status).toBe('abandoned');
    h.command({ ...startQuest, commandId: 'c2' });
    expect(view(h.state).campaign?.status).toBe('active');
  });
});

describe('losing contact', () => {
  it('arms the silence timer mid-turn and marks the hero unknown when it fires', () => {
    const h = arrived();
    expect(h.effects).toContainEqual({
      type: 'setTimer',
      timerId: 'silence:h4',
      at: 1_000 + SILENCE_MS,
    });
    h.timer('silence:h4', 1_000 + SILENCE_MS);
    expect(h.hero().state).toEqual({ kind: 'unknown', reason: 'No events for 5 min.' });
    h.agent({ type: 'message', text: 'still here' }, 1_000 + SILENCE_MS + 10);
    expect(h.hero().state).toEqual({ kind: 'working' });
  });

  it('does not time out while a tool runs, or while the hero is idle or waiting on you', () => {
    const running = arrived().agent({ type: 'activityStarted', toolUseId: 'u1', kind: 'test' });
    expect(running.effects.at(-1)).toEqual({ type: 'cancelTimer', timerId: 'silence:h4' });
    const idle = arrived().agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(idle.effects.at(-1)).toEqual({ type: 'cancelTimer', timerId: 'silence:h4' });
    const asking = arrived().agent({ type: 'permission', requestId: 'r', tool: 'Bash', input: {} });
    expect(asking.effects.at(-1)).toEqual({ type: 'cancelTimer', timerId: 'silence:h4' });
  });

  it('reports a session that never started', () => {
    const h = new Harness()
      .command(startQuest)
      .gm({ type: 'worktreeCreated', islandId: 'i2', path: '/wt', branch: 'b' })
      .timer('silence:h4', SILENCE_MS);
    expect(h.hero().state).toEqual({
      kind: 'unknown',
      reason: 'The session has not started after 5 min.',
    });
  });
});

describe('HP and gold', () => {
  it('takes exact readings from usage, and resets HP after a rest', () => {
    const h = arrived().agent({
      type: 'usage',
      contextUsed: 120_000,
      contextMax: 200_000,
      totalCost: 1_250_000,
    });
    expect(h.hero().hp).toEqual({ kind: 'exact', value: { used: 120_000, max: 200_000 } });
    expect(h.hero().gold).toEqual({ kind: 'exact', value: 1_250_000 });
    expect(view(h.state).campaign?.gold).toEqual({ kind: 'exact', value: 1_250_000 });
    h.agent({ type: 'resting' });
    expect(h.hero().state).toEqual({ kind: 'resting' });
    h.agent({ type: 'compacted', trigger: 'auto', preTokens: 120_000, postTokens: 30_000 });
    expect(h.hero().hp).toEqual({ kind: 'exact', value: { used: 30_000, max: 200_000 } });
  });

  it('keeps HP unknown when usage omits the context window', () => {
    const h = arrived().agent({ type: 'usage', totalCost: 10 });
    expect(h.hero().hp).toEqual({ kind: 'unknown' });
  });

  it('sums gold in core: unknown wins, estimates are marked', () => {
    expect(sumGold([{ kind: 'exact', value: 1 }, { kind: 'unknown' }])).toEqual({
      kind: 'unknown',
    });
    expect(
      sumGold([
        { kind: 'exact', value: 1 },
        { kind: 'estimated', value: 2, basis: 'price table' },
      ]),
    ).toEqual({ kind: 'estimated', value: 3, basis: 'price table' });
    expect(sumGold([])).toEqual({ kind: 'exact', value: 0 });
  });
});

describe('state precedence (§5.4)', () => {
  // unknown > error > outOfGold > stalled > waitingOnYou > resting > working > submitted > idle > traveling
  const base = (): HeroRecord => ({
    id: 'h',
    name: 'n',
    classId: 'ranger',
    islandId: 'i',
    taskPointId: null,
    sessionStarted: true,
    inTurn: true,
    runningTools: [],
    lastMessage: null,
    heldFor: [],
    campaignCapped: false,
    allowRules: [],
    resting: true,
    pendingSubmit: null,
    submitted: { summary: 's' },
    unknownReason: 'lost',
    error: 'boom',
    outOfGold: true,
    hp: { kind: 'unknown' },
    gold: { kind: 'unknown' },
    queuedMessages: 0,
    sessionId: 's1',
    sessionLive: true,
    stalled: 'stuck',
    cap: null,
    watch: Hero.freshWatch(),
  });
  const asking: CoreState = {
    ...initialState(),
    needsYou: [{ kind: 'reply', id: 'x', heroId: 'other', text: '' }],
  };
  const waiting: CoreState = {
    ...initialState(),
    needsYou: [{ kind: 'question', id: 'q', heroId: 'h', requestId: 'r', questions: [] }],
  };

  it('picks the highest condition that holds', () => {
    const h = base();
    const order: [Partial<HeroRecord>, CoreState, string][] = [
      [{}, waiting, 'unknown'],
      [{ unknownReason: null }, waiting, 'error'],
      [{ unknownReason: null, error: null }, waiting, 'outOfGold'],
      [{ unknownReason: null, error: null, outOfGold: false }, waiting, 'stalled'],
      [
        { unknownReason: null, error: null, outOfGold: false, stalled: null },
        waiting,
        'waitingOnYou',
      ],
      [{ unknownReason: null, error: null, outOfGold: false, stalled: null }, asking, 'resting'],
      [
        { unknownReason: null, error: null, outOfGold: false, resting: false, stalled: null },
        asking,
        'working',
      ],
      [
        {
          unknownReason: null,
          error: null,
          outOfGold: false,
          resting: false,
          inTurn: false,
          stalled: null,
        },
        asking,
        'submitted',
      ],
      [
        {
          unknownReason: null,
          error: null,
          outOfGold: false,
          resting: false,
          inTurn: false,
          submitted: null,
          stalled: null,
        },
        asking,
        'idle',
      ],
      [
        {
          unknownReason: null,
          error: null,
          outOfGold: false,
          resting: false,
          inTurn: false,
          submitted: null,
          sessionStarted: false,
          stalled: null,
        },
        asking,
        'traveling',
      ],
    ];
    for (const [patch, state, kind] of order) {
      expect(executionState({ ...h, ...patch }, state).kind).toBe(kind);
    }
  });
});

describe('purity', () => {
  it('never mutates the state it is given', () => {
    const before = arrived().state;
    const frozen = JSON.stringify(before);
    step(before, {
      kind: 'agent',
      t: 5,
      heroId: 'h4',
      event: { type: 'turnEnded', queuedTurns: 0 },
    });
    expect(JSON.stringify(before)).toBe(frozen);
  });

  it('gives the same result for the same inputs', () => {
    expect(JSON.stringify(arrived().state)).toBe(JSON.stringify(arrived().state));
  });
});

describe('describePermission', () => {
  it.each([
    {
      tool: 'Bash',
      input: { command: 'pnpm install' },
      expected: { action: 'Run command', target: 'pnpm install' },
    },
    {
      tool: 'Edit',
      input: { file_path: 'src/auth.ts' },
      expected: { action: 'Edit file', target: 'src/auth.ts' },
    },
    {
      tool: 'Write',
      input: { file_path: 'a.md', content: 'x' },
      expected: { action: 'Write file', target: 'a.md' },
    },
    {
      tool: 'WebFetch',
      input: { url: 'https://x.dev' },
      expected: { action: 'Fetch URL', target: 'https://x.dev' },
    },
    {
      tool: 'mcp__db__query',
      input: { sql: 'drop table' },
      expected: { action: 'mcp__db__query', target: '{"sql":"drop table"}' },
    },
    {
      tool: 'Bash',
      input: { cmd: 'odd shape' },
      expected: { action: 'Bash', target: '{"cmd":"odd shape"}' },
    },
  ])('$tool $input', ({ tool, input, expected }) => {
    expect(describePermission(tool, input)).toEqual(expected);
  });
});
