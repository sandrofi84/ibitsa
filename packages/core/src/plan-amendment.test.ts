import type { Command, CouncilEvent, Cue, Plan, PlanTask } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import type { CoreInput } from './inputs.types';
import { Sitting } from './sitting';
import { DEFAULT_SETTINGS, initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: `Task ${id}`,
  description: `Do ${id}.`,
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
  ...extra,
});
const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };
const PLAN: Plan = {
  summary: 'Sign-in',
  goal: 'Sign-in',
  tasks: [task('T1'), task('T2', { dependsOn: ['T1'] })],
  decisions: [],
  islands: [{ id: 'I1', title: 'Backend', tasks: ['T1', 'T2'] }],
  branching: 'separate',
};
const EMPTY = { tasks: [], removeTasks: [], addToIslands: [], islands: [], decisions: [] };

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
  council(event: CouncilEvent): this {
    return this.feed({ kind: 'council', t: 0, sittingId: this.state.sitting?.id ?? '', event });
  }
  agent(event: Parameters<typeof step>[1] extends never ? never : Record<string, unknown>): this {
    return this.feed({
      kind: 'agent',
      t: 0,
      heroId: this.state.heroes[0]?.id ?? '',
      event: event as never,
    });
  }
  /** Convened with security, the plan approved, the campaign started and the hero at work on T1. */
  started(plan: Plan = PLAN): this {
    this.feed({
      kind: 'gm',
      t: 0,
      event: { type: 'questSettings', ...DEFAULT_SETTINGS, maxParallel: 3 },
    });
    this.do({
      type: 'conveneCouncil',
      task: 'Sign-in',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'standard',
    });
    this.council({ type: 'sessionStarted', sessionId: 'lead-1' });
    this.council({ type: 'reportFiled', toolUseId: 'r', councillorId: 'security', report: REPORT });
    this.council({ type: 'planProposed', toolUseId: 'p', plan });
    this.do({ type: 'approvePlan', version: 1 });
    this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: (plan.islands ?? []).map((i, k) => ({
        islandId: i.id,
        heroName: `Hero ${k}`,
        classId: 'ranger',
      })),
    });
    const island = this.state.islands[0];
    this.feed({
      kind: 'gm',
      t: 0,
      event: {
        type: 'worktreeCreated',
        islandId: island?.id ?? '',
        path: '/wt',
        branch: island?.branch ?? '',
      },
    });
    this.agent({ type: 'sessionStarted', sessionId: 'hero-1' });
    this.effects = [];
    return this;
  }
  /** The council, asked a question, proposes an amendment in that turn. */
  propose(amendment: unknown, toolUseId = 'a1'): this {
    if (!this.state.sitting?.consultations?.some((c) => c.status === 'asking'))
      this.do({ type: 'consultCouncil', text: 'Should we add a logout?' });
    return this.council({ type: 'amendmentProposed', toolUseId, amendment });
  }
  last<T extends Effect['type']>(type: T): Extract<Effect, { type: T }> | undefined {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type).at(-1);
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
  amendments() {
    return view(this.state).sitting?.amendments ?? [];
  }
  titles(island = 0): string[] {
    return this.state.islands[island]?.taskPoints.map((tp) => `${tp.title}:${tp.state}`) ?? [];
  }
}

const LOGOUT = {
  ...EMPTY,
  summary: 'Add a logout, and say what T2 checks.',
  tasks: [
    task('T3', { title: 'Logout' }),
    task('T2', { title: 'Check the session', dependsOn: ['T1'] }),
  ],
  addToIslands: [{ islandId: 'I1', tasks: ['T3'] }],
};

describe('plan amendments (spec §4.8, #170)', () => {
  it('keeps a valid amendment for the user, with its change set; a newer one supersedes it', () => {
    const run = new Run().started();
    run.propose(LOGOUT);
    expect(run.last('completeSittingTool')).toMatchObject({ toolUseId: 'a1', accepted: true });
    expect(run.amendments()).toEqual([
      {
        number: 1,
        amendment: LOGOUT,
        changes: [
          { kind: 'added', taskId: 'T3', title: 'Logout', island: 'Backend' },
          {
            kind: 'edited',
            taskId: 'T2',
            title: 'Check the session',
            before: 'Task T2',
            island: 'Backend',
          },
        ],
        outcome: { kind: 'proposed' },
      },
    ]);
    run.propose({ ...LOGOUT, summary: 'Just the logout.' }, 'a2');
    expect(run.amendments().map((a) => [a.number, a.outcome.kind])).toEqual([
      [1, 'superseded'],
      [2, 'proposed'],
    ]);
  });

  it('refuses touching work that started, broken references, and an amendment that changes nothing', () => {
    const run = new Run().started();
    const refused = (amendment: unknown) => {
      run.propose(amendment, `x${run.effects.length}`);
      return run.last('completeSittingTool')?.reason ?? '';
    };
    expect(
      refused({ ...EMPTY, summary: 'Rework T1', tasks: [task('T1', { title: 'Again' })] }),
    ).toContain("T1 has started, so it can't change: rework is a new task.");
    expect(refused({ ...EMPTY, summary: 'Drop T1', removeTasks: ['T1'] })).toContain(
      "T1 has started, so it can't be removed.",
    );
    expect(refused({ ...EMPTY, summary: 'Drop T9', removeTasks: ['T9'] })).toContain(
      "T9 isn't a task, so it can't be removed.",
    );
    expect(refused({ ...LOGOUT, addToIslands: [{ islandId: 'I7', tasks: ['T3'] }] })).toContain(
      "I7 isn't an island of the plan.",
    );
    expect(
      refused({
        ...EMPTY,
        summary: 'Lonely',
        tasks: [task('T4', { dependsOn: ['T8'] })],
        addToIslands: [{ islandId: 'I1', tasks: ['T4'] }],
      }),
    ).toContain("T4 depends on T8, which isn't a task.");
    expect(refused({ ...EMPTY, summary: 'Nothing' })).toContain('The amendment changes nothing.');
    expect(refused({ summary: 'Bad' })).toContain('tasks');
    expect(run.amendments()).toEqual([]);
  });

  it('refuses an amendment while the council plans, or outside a question', () => {
    const run = new Run().started();
    run.council({ type: 'amendmentProposed', toolUseId: 'late', amendment: LOGOUT });
    expect(run.last('completeSittingTool')).toMatchObject({ toolUseId: 'late', accepted: false });

    const planning = new Run();
    planning.feed({ kind: 'gm', t: 0, event: { type: 'questSettings', ...DEFAULT_SETTINGS } });
    planning.do({
      type: 'conveneCouncil',
      task: 'x',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'light',
    });
    planning.council({ type: 'sessionStarted', sessionId: 's' });
    planning.council({ type: 'amendmentProposed', toolUseId: 'early', amendment: LOGOUT });
    expect(planning.last('completeSittingTool')).toMatchObject({
      accepted: false,
      reason: 'There is no approved plan to amend yet: propose the whole plan with propose_plan.',
    });
  });

  it('applies an approved amendment to the islands and the plan, saves it, and tells the hero', () => {
    const run = new Run().started();
    run.propose(LOGOUT).council({ type: 'usage', totalCost: 10_000 });
    run.effects = [];
    run.do({ type: 'approveAmendment', number: 1 });
    expect(run.rejections()).toEqual([]);
    expect(run.titles()).toEqual(['Task T1:active', 'Check the session:locked', 'Logout:locked']);
    const plan = Sitting.approvedPlan(run.state);
    expect(plan?.tasks.map((t) => t.id)).toEqual(['T1', 'T2', 'T3']);
    expect(run.last('saveAmendment')).toMatchObject({
      version: 1,
      amendments: [{ number: 1, amendment: LOGOUT }],
      plan: { islands: [{ id: 'I1', tasks: ['T1', 'T2', 'T3'] }] },
    });
    expect(run.last('sendMessage')?.text).toBe(
      'The plan was amended (Amendment 1): Add a logout, and say what T2 checks.\nOn your island: changed "Check the session"; added "Logout".\nCarry on with your current task; the changed tasks come to you in turn.',
    );
    expect(run.amendments()[0]?.outcome).toEqual({ kind: 'approved' });
    run.do({ type: 'approveAmendment', number: 1 });
    expect(run.rejections()).toEqual(["Amendment 1 isn't waiting for you."]);
  });

  it('checks again at approval: work that started since stops it', () => {
    const run = new Run().started();
    run.propose({ ...EMPTY, summary: 'Drop T2', removeTasks: ['T2'] });
    // T1 is handed in, so the hero moves on to T2 before the user decides.
    run.agent({ type: 'taskSubmitted', toolUseId: 's1', summary: 'Done' });
    run.feed({
      kind: 'gm',
      t: 0,
      event: {
        type: 'submitChecked',
        heroId: run.state.heroes[0]?.id ?? '',
        toolUseId: 's1',
        ok: true,
      },
    });
    run.do({ type: 'approveAmendment', number: 1 });
    expect(run.rejections()).toEqual([
      "Since it was proposed: T2 has started, so it can't be removed.",
    ]);
    expect(run.amendments()[0]?.outcome.kind).toBe('proposed');
  });

  it('adds an island that waits for its party, then for a slot; stacked, it joins the end of the line', () => {
    const run = new Run().started({ ...PLAN, branching: 'stacked' });
    run.propose({
      ...EMPTY,
      summary: 'A frontend island',
      tasks: [task('T5', { title: 'Login form' })],
      islands: [{ id: 'I2', title: 'Frontend', tasks: ['T5'] }],
    });
    run.do({ type: 'approveAmendment', number: 1 });
    const added = run.state.islands[1];
    expect(added).toMatchObject({
      name: 'Frontend',
      branch: 'ibitsa/frontend',
      awaitingParty: true,
      launched: false,
      basedOn: run.state.islands[0]?.id,
      baseRef: run.state.islands[0]?.branch,
      planIslandId: 'I2',
    });
    expect(run.state.heroes).toHaveLength(1);
    expect(view(run.state).islands[1]?.worktree).toBe('waiting');

    run.do({
      type: 'assembleParty',
      islandId: added?.id,
      heroName: 'Vex',
      classId: 'rogue',
      budgetMicroUsd: 2_000_000,
      reviewEfforts: { security: 'deep' },
    });
    expect(run.state.heroes[1]).toMatchObject({
      name: 'Vex',
      classId: 'rogue',
      islandId: added?.id,
      taskPointId: added?.taskPoints[0]?.id,
    });
    expect(run.state.islands[1]?.reviewEfforts).toEqual({ security: 'deep' });
    expect(run.state.islands[1]?.awaitingParty).toBe(false);
    run.do({ type: 'assembleParty', islandId: added?.id, heroName: 'Again', classId: 'rogue' });
    expect(run.rejections()).toEqual(['That island already has its party.']);
  });

  it('gives new work to a hero whose island was done, resuming its session', () => {
    const run = new Run().started({
      ...PLAN,
      tasks: [task('T1')],
      islands: [{ id: 'I1', title: 'Backend', tasks: ['T1'] }],
    });
    run.agent({ type: 'taskSubmitted', toolUseId: 's1', summary: 'Done' });
    run.feed({
      kind: 'gm',
      t: 0,
      event: {
        type: 'submitChecked',
        heroId: run.state.heroes[0]?.id ?? '',
        toolUseId: 's1',
        ok: true,
      },
    });
    run.agent({ type: 'turnEnded', queuedTurns: 0 });
    expect(run.state.heroes[0]?.submitted).not.toBeNull();
    run.feed({ kind: 'gm', t: 0, event: { type: 'runtimeRestarted' } });
    run.propose({ ...LOGOUT, tasks: [task('T3', { title: 'Logout' })] });
    run.effects = [];
    run.do({ type: 'approveAmendment', number: 1 });
    expect(run.state.heroes[0]?.submitted).toBeNull();
    expect(run.titles()).toEqual(['Task T1:doneUnreviewed', 'Logout:active']);
    expect(run.last('resumeSession')).toMatchObject({ sessionId: 'hero-1' });
    expect(run.last('resumeSession')?.prompt).toContain('Do T3.');
  });

  it('sends an amendment back with a note, or discards it', () => {
    const run = new Run().started();
    run.propose(LOGOUT);
    run.do({ type: 'requestAmendmentChange', number: 1, text: 'No logout yet' });
    expect(run.rejections()).toEqual(['The council is still answering the last question.']);
    run.council({ type: 'usage', totalCost: 10_000 });
    run.do({ type: 'requestAmendmentChange', number: 1, text: 'No logout yet' });
    expect(run.amendments()[0]?.outcome).toEqual({
      kind: 'changeRequested',
      note: 'No logout yet',
    });
    expect(run.last('startSitting')?.resume?.prompt).toContain(
      'The user asked for changes to Amendment 1:\nNo logout yet',
    );
    expect(view(run.state).sitting?.dialogue.at(-1)).toMatchObject({
      speaker: 'you',
      text: 'Amendment 1: No logout yet',
    });
    run.propose({ ...LOGOUT, summary: 'Only T2.' }, 'a2');
    run.do({ type: 'discardAmendment', number: 2 });
    expect(run.amendments().map((a) => a.outcome.kind)).toEqual(['changeRequested', 'discarded']);
    run.do({ type: 'discardAmendment', number: 9 });
    expect(run.rejections().at(-1)).toBe("Amendment 9 isn't waiting for you.");
  });
});
