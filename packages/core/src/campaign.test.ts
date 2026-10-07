import type { AgentEvent, Command, Cue, Plan, PlanTask } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { DEFAULT_SETTINGS, initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const task = (id: string, dependsOn: string[] = []): PlanTask => ({
  id,
  title: `Task ${id}`,
  description: `Do ${id}.`,
  files: [],
  dependsOn,
  criteria: [],
  decisions: [],
});
const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };

class Run {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  private n = 0;
  feed(input: CoreInput): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    return this;
  }
  do(command: Record<string, unknown> & { type: Command['type'] }): this {
    return this.feed({
      kind: 'command',
      t: 0,
      command: { commandId: `c${++this.n}`, ...command } as Command,
    });
  }
  gm(event: GameMasterEvent): this {
    return this.feed({ kind: 'gm', t: 0, event });
  }
  agent(heroId: string, event: AgentEvent): this {
    return this.feed({ kind: 'agent', t: 0, heroId, event });
  }
  /** Settings, then a council that approves `plan`. */
  approved(plan: Partial<Plan>, settings: Partial<CoreState['settings']> = {}): this {
    this.gm({ type: 'questSettings', ...DEFAULT_SETTINGS, ...settings });
    this.do({
      type: 'conveneCouncil',
      task: 'Build it',
      mode: 'roundTable',
      roster: ['tester'],
      effort: 'light',
    });
    const sittingId = this.state.sitting?.id ?? '';
    this.feed({
      kind: 'council',
      t: 0,
      sittingId,
      event: { type: 'reportFiled', toolUseId: 'r', councillorId: 'tester', report: REPORT },
    });
    const full: Plan = {
      summary: 'Plan',
      goal: 'Build it',
      tasks: [task('T1')],
      decisions: [],
      ...plan,
    };
    this.feed({
      kind: 'council',
      t: 0,
      sittingId,
      event: { type: 'planProposed', toolUseId: 'p', plan: full },
    });
    return this.do({ type: 'approvePlan', version: 1 });
  }
  start(extra: Record<string, unknown> = {}): this {
    const islands = this.state.sitting?.plans.at(-1)?.plan.islands ?? [{ id: 'I1' }];
    return this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: islands.map((i, n) => ({
        islandId: i.id,
        heroName: `Hero ${n + 1}`,
        classId: 'ranger',
      })),
      ...extra,
    });
  }
  island(n: number) {
    const island = this.state.islands[n];
    if (!island) throw new Error(`no island ${n}`);
    return island;
  }
  hero(n: number) {
    const hero = this.state.heroes[n];
    if (!hero) throw new Error(`no hero ${n}`);
    return hero;
  }
  worktrees(): { islandId: string; branch: string; baseRef: string }[] {
    return this.effects.flatMap((e) =>
      e.type === 'createWorktree'
        ? [{ islandId: e.islandId, branch: e.branch, baseRef: e.baseRef }]
        : [],
    );
  }
  ready(n: number): this {
    const island = this.island(n);
    this.gm({
      type: 'worktreeCreated',
      islandId: island.id,
      path: `/wt/${island.id}`,
      branch: island.branch,
    });
    return this.agent(this.hero(n).id, { type: 'sessionStarted', sessionId: `s${n}` });
  }
  submit(n: number): this {
    const id = `sub${++this.n}`;
    this.agent(this.hero(n).id, { type: 'taskSubmitted', toolUseId: id, summary: 'Done' });
    this.gm({ type: 'submitChecked', heroId: this.hero(n).id, toolUseId: id, ok: true });
    return this.agent(this.hero(n).id, { type: 'turnEnded', queuedTurns: 0 });
  }
  states(): string[] {
    return view(this.state).heroes.map((h) =>
      h.state.kind === 'blocked' ? `blocked:${h.state.reason}` : h.state.kind,
    );
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

const three = {
  tasks: [task('T1'), task('T2'), task('T3')],
  islands: [
    { id: 'I1', title: 'Backend', tasks: ['T1'] },
    { id: 'I2', title: 'Frontend', tasks: ['T2'] },
    { id: 'I3', title: 'Docs', tasks: ['T3'] },
  ],
};

describe('a campaign with several parties (#121)', () => {
  it('needs an approved plan and a party for every island, once', () => {
    expect(new Run().start().rejections()).toEqual(['There is no approved plan to carry out.']);
    const run = new Run().approved(three);
    run.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: [{ islandId: 'I1', heroName: 'A', classId: 'rogue' }],
    });
    expect(run.rejections()).toEqual(['Every island needs a party: I2, I3.']);
    run.start({
      parties: ['I1', 'I2', 'I3', 'I9'].map((islandId) => ({
        islandId,
        heroName: 'A',
        classId: 'rogue',
      })),
    });
    expect(run.rejections().at(-1)).toBe('Each party needs an island of the plan, once.');
  });

  it('starts as many islands as there are slots, from the base; the rest wait and start when one frees', () => {
    const run = new Run().approved(three, { maxParallel: 2 }).start();
    expect(view(run.state).campaign).toMatchObject({
      status: 'active',
      branching: 'separate',
      stackedStart: null,
    });
    expect(run.worktrees()).toEqual([
      { islandId: run.island(0).id, branch: 'ibitsa/backend', baseRef: 'main' },
      { islandId: run.island(1).id, branch: 'ibitsa/frontend', baseRef: 'main' },
    ]);
    expect(view(run.state).islands.map((i) => i.worktree)).toEqual([
      'creating',
      'creating',
      'waiting',
    ]);
    expect(run.states()).toEqual(['traveling', 'traveling', 'blocked:slot']);
    run.ready(0).ready(1).submit(0);
    expect(run.worktrees().at(-1)).toEqual({
      islandId: run.island(2).id,
      branch: 'ibitsa/docs',
      baseRef: 'main',
    });
    expect(run.states()).toEqual(['submitted', 'working', 'traveling']);
  });

  it('keeps an island waiting while its first task depends on an unfinished task elsewhere', () => {
    const run = new Run()
      .approved({
        tasks: [task('T1'), task('T2', ['T1'])],
        islands: [
          { id: 'I1', title: 'One', tasks: ['T1'] },
          { id: 'I2', title: 'Two', tasks: ['T2'] },
        ],
      })
      .start();
    expect(run.worktrees()).toHaveLength(1);
    expect(run.states()).toEqual(['traveling', 'blocked:dependency']);
    run.ready(0).submit(0);
    expect(run.worktrees()).toHaveLength(2);
  });

  it('holds a hero whose next task waits on another island, then hands it over once that is done', () => {
    const run = new Run()
      .approved({
        tasks: [task('T1'), task('T2'), task('T3', ['T2'])],
        islands: [
          { id: 'I1', title: 'One', tasks: ['T1', 'T3'] },
          { id: 'I2', title: 'Two', tasks: ['T2'] },
        ],
      })
      .start()
      .ready(0)
      .ready(1);
    run.effects = [];
    run.submit(0);
    expect(run.states()[0]).toBe('blocked:dependency');
    expect(run.hero(0).heldFor).toEqual(['T2']);
    expect(run.effects.some((e) => e.type === 'sendMessage')).toBe(false);
    run.submit(1);
    expect(run.states()[0]).toBe('idle');
    const message = run.effects.find(
      (e) => e.type === 'sendMessage' && e.heroId === run.hero(0).id,
    );
    expect(message?.type === 'sendMessage' && message.text).toContain('Do T3.');
    expect(view(run.state).islands[0]?.taskPoints.map((t) => t.state)).toEqual([
      'doneUnreviewed',
      'active',
    ]);
  });

  const stacked = {
    tasks: [task('T1'), task('T2')],
    islands: [
      { id: 'I1', title: 'Schema', tasks: ['T1'] },
      { id: 'I2', title: 'API', tasks: ['T2'] },
    ],
    branching: 'stacked' as const,
  };

  it('stacked, each when the one before is cleared: the next branches from the previous branch then', () => {
    const run = new Run().approved(stacked).start();
    expect(view(run.state).campaign).toMatchObject({
      branching: 'stacked',
      stackedStart: 'cleared',
    });
    expect(view(run.state).islands[1]).toMatchObject({
      basedOn: run.island(0).id,
      worktree: 'waiting',
    });
    expect(run.states()).toEqual(['traveling', 'blocked:previousIsland']);
    run.ready(0).submit(0);
    expect(run.worktrees().at(-1)).toEqual({
      islandId: run.island(1).id,
      branch: 'ibitsa/api',
      baseRef: 'ibitsa/schema',
    });
  });

  it('stacked: branches from the branch git actually made for the island before, suffix and all (#122)', () => {
    const run = new Run().approved(stacked).start();
    run.gm({
      type: 'worktreeCreated',
      islandId: run.island(0).id,
      path: '/wt/a',
      branch: 'ibitsa/schema-2',
    });
    run.agent(run.hero(0).id, { type: 'sessionStarted', sessionId: 's' });
    run.submit(0);
    expect(run.worktrees().at(-1)?.baseRef).toBe('ibitsa/schema-2');
    expect(run.island(1).baseRef).toBe('ibitsa/schema-2');
  });

  it('stacked, all at once: the next starts once the first worktree exists, and rebases between its turns', () => {
    const run = new Run().approved(stacked).start({ stackedStart: 'together' });
    expect(run.worktrees()).toHaveLength(1);
    run.ready(0);
    expect(run.worktrees()).toHaveLength(2);
    run.ready(1);
    run.effects = [];
    const hero2 = run.hero(1).id;
    run.agent(hero2, { type: 'turnStarted' }).agent(hero2, { type: 'turnEnded', queuedTurns: 0 });
    expect(run.effects).toContainEqual({
      type: 'rebaseWorktree',
      islandId: run.island(1).id,
      worktreePath: `/wt/${run.island(1).id}`,
      onto: 'ibitsa/schema',
    });
    run.effects = [];
    run.gm({ type: 'worktreeRebased', islandId: run.island(1).id, outcome: 'conflict' });
    run.gm({ type: 'worktreeRebased', islandId: run.island(1).id, outcome: 'conflict' });
    expect(view(run.state).islands[1]?.behind).toBe(true);
    const asked = run.effects.filter((e) => e.type === 'sendMessage');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.type === 'sendMessage' && asked[0].text).toContain('git rebase ibitsa/schema');
    run.gm({ type: 'worktreeRebased', islandId: run.island(1).id, outcome: 'rebased' });
    expect(view(run.state).islands[1]?.behind).toBe(false);
    run.gm({ type: 'worktreeRebased', islandId: 'nowhere', outcome: 'conflict' });
  });

  it("stops every working hero at the campaign's cap, and lets them carry on when it is raised", () => {
    const run = new Run()
      .approved(three, { maxParallel: 3, campaignBudgetMicroUsd: 1_000_000 })
      .start();
    expect(view(run.state).campaign?.capMicroUsd).toBe(1_000_000);
    run.ready(0).ready(1).ready(2);
    for (const [n, cost] of [
      [0, 300_000],
      [1, 300_000],
    ] as const) {
      run.agent(run.hero(n).id, { type: 'usage', totalCost: cost });
    }
    expect(run.states().every((s) => s !== 'outOfGold')).toBe(true);
    run.effects = [];
    run.agent(run.hero(2).id, { type: 'turnStarted' });
    run.agent(run.hero(2).id, { type: 'usage', totalCost: 450_000 });
    expect(run.states()).toEqual(['outOfGold', 'outOfGold', 'outOfGold']);
    expect(view(run.state).needsYou.filter((i) => i.kind === 'outOfGold')).toHaveLength(3);
    expect(view(run.state).needsYou[0]).toMatchObject({
      kind: 'outOfGold',
      cap: 1_000_000,
      scope: 'campaign',
    });
    expect(run.effects).toContainEqual({ type: 'interrupt', heroId: run.hero(2).id });
    run.do({ type: 'raiseCampaignBudget', addMicroUsd: 1_000_000 });
    expect(run.states()).toEqual(['idle', 'idle', 'idle']);
    expect(view(run.state).campaign?.capMicroUsd).toBe(2_000_000);
  });

  it("can't raise a cap that doesn't exist, and a raise that is still short changes nothing", () => {
    const none = new Run().approved(three).start();
    none.do({ type: 'raiseCampaignBudget', addMicroUsd: 1 });
    expect(none.rejections()).toEqual(['This campaign has no cap.']);
    const short = new Run().approved(three, { campaignBudgetMicroUsd: 100 }).start().ready(0);
    short.agent(short.hero(0).id, { type: 'usage', totalCost: 500 });
    short.do({ type: 'raiseCampaignBudget', addMicroUsd: 100 });
    expect(short.states()[0]).toBe('outOfGold');
  });

  it("gives each hero its party's gold pouch, or none", () => {
    const run = new Run().approved(three, { budgetMicroUsd: 5_000_000 }).start({
      parties: [
        { islandId: 'I1', heroName: 'A', classId: 'rogue' },
        { islandId: 'I2', heroName: 'B', classId: 'rogue', budgetMicroUsd: 1_000_000 },
        { islandId: 'I3', heroName: 'C', classId: 'rogue', budgetMicroUsd: null },
      ],
    });
    expect(run.state.heroes.map((h) => h.cap?.microUsd ?? null)).toEqual([
      5_000_000,
      1_000_000,
      null,
    ]);
  });

  it('asks again for a worktree being made when VS Code reloads, leaves waiting heroes alone, and names clashing branches apart', () => {
    const run = new Run()
      .approved(
        {
          tasks: [task('T1'), task('T2'), task('T3')],
          islands: [
            { id: 'I1', title: 'Same', tasks: ['T1'] },
            { id: 'I2', title: 'Same', tasks: ['T2'] },
            { id: 'I3', title: 'Same', tasks: ['T3'] },
          ],
        },
        { maxParallel: 1 },
      )
      .start();
    expect(run.state.islands.map((i) => i.branch)).toEqual([
      'ibitsa/same',
      'ibitsa/same-2',
      'ibitsa/same-3',
    ]);
    run.effects = [];
    run.gm({ type: 'runtimeRestarted' });
    expect(view(run.state).needsYou).toHaveLength(0);
    expect(run.states()).toEqual(['traveling', 'blocked:slot', 'blocked:slot']);
    expect(run.effects).toContainEqual({
      type: 'createWorktree',
      islandId: run.state.islands[0]?.id,
      branch: 'ibitsa/same',
      baseRef: 'main',
    });
  });
});

describe('ending a campaign with several parties (#126)', () => {
  it('finishes only once every island is submitted, naming the open ones', () => {
    const run = new Run().approved(three, { maxParallel: 3 }).start().ready(0).ready(1).ready(2);
    run.submit(0);
    run.do({ type: 'finishQuest' });
    expect(run.rejections()).toEqual(['Not every island is submitted yet: Frontend, Docs.']);
    run.submit(1).submit(2).do({ type: 'finishQuest' });
    expect(view(run.state).campaign?.status).toBe('finished');
    expect(run.effects.filter((e) => e.type === 'closeSession')).toHaveLength(3);
  });

  it('abandons every party, started or not, and keeps the worktrees to remove one by one', () => {
    const run = new Run().approved(three, { maxParallel: 1 }).start().ready(0);
    run.do({ type: 'abandonQuest' });
    expect(view(run.state).campaign?.status).toBe('abandoned');
    expect(view(run.state).islands.map((i) => i.worktree)).toEqual(['ready', 'waiting', 'waiting']);
    // Nothing more starts after the end.
    expect(run.worktrees()).toHaveLength(1);
    run.do({ type: 'removeWorktree', islandId: run.island(0).id });
    expect(run.effects.at(-1)).toMatchObject({
      type: 'removeWorktree',
      islandId: run.island(0).id,
    });
  });
});
