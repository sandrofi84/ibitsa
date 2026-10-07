import type { AgentEvent, Command, Cue, Plan, PlanTask, Verdict } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import type { CoreInput, GameMasterEvent } from './inputs.types';
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
  summary: 'Email sign-in.',
  goal: 'Sign-in',
  tasks: [
    task('T1', { criteria: [{ councillorId: 'security', items: ['Hashed'] }], decisions: ['D1'] }),
    task('T2'),
  ],
  decisions: [
    {
      id: 'D1',
      title: 'Methods',
      raisedBy: 'security',
      chosen: 'Email',
      alternatives: [],
      why: 'Simple',
      affects: ['T1'],
    },
  ],
  islands: [{ id: 'I1', title: 'Sign-in', tasks: ['T1', 'T2'] }],
};

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
  agent(event: AgentEvent): this {
    return this.feed({ kind: 'agent', t: 0, heroId: this.state.heroes[0]?.id ?? '', event });
  }
  /** A planned campaign with reviews on, its council's session noted, and its hero at work. */
  started(): this {
    this.gm({ type: 'questSettings', ...DEFAULT_SETTINGS, reviews: true });
    this.do({
      type: 'conveneCouncil',
      task: 'Sign-in',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'light',
    });
    const sittingId = this.state.sitting?.id ?? '';
    const council = (event: Extract<CoreInput, { kind: 'council' }>['event']) =>
      this.feed({ kind: 'council', t: 0, sittingId, event });
    council({ type: 'sessionStarted', sessionId: 'council-1' });
    council({
      type: 'usage',
      totalCost: 40_000,
      byModel: [
        {
          model: 'sonnet',
          inputTokens: 1_000,
          outputTokens: 500,
          cacheReadTokens: 90_000,
          cacheWriteTokens: 8_000,
          costMicroUsd: 40_000,
        },
      ],
      byCouncillor: [],
    } as never);
    council({ type: 'reportFiled', toolUseId: 'r', councillorId: 'security', report: REPORT });
    council({ type: 'planProposed', toolUseId: 'p', plan: PLAN });
    this.do({ type: 'approvePlan', version: 1 });
    this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: [{ islandId: 'I1', heroName: 'Ilse', classId: 'ranger' }],
    });
    const island = this.state.islands[0];
    this.gm({
      type: 'worktreeCreated',
      islandId: island?.id ?? '',
      path: '/wt',
      branch: island?.branch ?? '',
    });
    return this.agent({ type: 'sessionStarted', sessionId: 'hero-1' });
  }
  submit(): this {
    const id = `sub${++this.n}`;
    this.agent({ type: 'taskSubmitted', toolUseId: id, summary: 'Done' });
    this.gm({
      type: 'submitChecked',
      heroId: this.state.heroes[0]?.id ?? '',
      toolUseId: id,
      ok: true,
      head: `h${this.n}`,
    });
    return this.agent({ type: 'turnEnded', queuedTurns: 0 });
  }
  /** The checks pass for the task under review (one without reviewers is then done). */
  checks(): this {
    const tp = this.state.islands[0]?.taskPoints.find((t) => t.state === 'underReview');
    return this.gm({ type: 'checksRan', taskPointId: tp?.id ?? '', results: [] });
  }
  /** Checks pass and the task's reviewer gives this verdict. */
  review(verdict: Verdict): this {
    const tp = this.state.islands[0]?.taskPoints.find((t) => t.state === 'underReview');
    this.gm({ type: 'checksRan', taskPointId: tp?.id ?? '', results: [] });
    const started = this.effects.filter((e) => e.type === 'startReview').at(-1);
    const reviewId = started?.type === 'startReview' ? started.reviewId : '';
    return this.feed({
      kind: 'review',
      t: 0,
      reviewId,
      event: { type: 'verdictSubmitted', toolUseId: `v${this.n++}`, verdict },
    });
  }
  last<T extends Effect['type']>(type: T): Extract<Effect, { type: T }> | undefined {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type).at(-1);
  }
  ending() {
    return view(this.state).campaign?.ending;
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

const BLOCK: Verdict = {
  verdict: 'changes',
  findings: [
    { severity: 'blocking', criterion: 'Hashed', message: 'Passwords are stored in plain text' },
  ],
};
const PASS_WITH_NOTE: Verdict = {
  verdict: 'pass',
  findings: [{ severity: 'suggestion', file: 'src/a.ts', line: 3, message: 'Name it better' }],
};

/** A campaign whose first task needed a second round, then passed; its second task was done too. */
function reviewed(): Run {
  const run = new Run().started();
  run.submit().review(BLOCK);
  run.submit().review(PASS_WITH_NOTE);
  return run.submit().checks();
}

describe('the campaign record (spec §4.9, #167)', () => {
  it('on Finish, has the elder write lessons from the reviews, then writes the record with them', () => {
    const run = reviewed();
    run.effects = [];
    run.do({ type: 'finishQuest' });
    const lessons = run.last('startLessons');
    expect(lessons?.material).toBe(
      [
        'Task "Task T1" (Sign-in): passed after 2 rounds.',
        '- Round 1, security blocked: Passwords are stored in plain text',
      ].join('\n'),
    );
    expect(run.last('writeRecord')).toBeUndefined();
    expect(run.ending()).toMatchObject({ record: 'lessons', councilContext: 'pending' });

    const event = (e: Extract<CoreInput, { kind: 'lessons' }>['event']) =>
      run.feed({ kind: 'lessons', t: 0, lessonsId: lessons?.lessonsId ?? '', event: e });
    event({ type: 'sessionStarted', sessionId: 'l-1' });
    event({ type: 'lessonsSubmitted', lessons: ['Brief the hero on hashing.'] });
    expect(run.last('writeRecord')).toBeUndefined();
    event({ type: 'usage', totalCost: 30_000 });
    const record = run.last('writeRecord')?.record;
    expect(record).toMatchObject({
      title: 'Sign-in',
      status: 'finished',
      summary: 'Email sign-in.',
      decisions: [{ id: 'D1' }],
      islands: [
        {
          name: 'Sign-in',
          tasks: [
            { title: 'Task T1', state: 'done' },
            { title: 'Task T2', state: 'done' },
          ],
          pullRequest: null,
        },
      ],
      deferred: {
        unfinished: [],
        suggestions: [
          { councillorId: 'security', message: 'Name it better', file: 'src/a.ts', line: 3 },
        ],
        revisits: [],
      },
      lessons: ['Brief the hero on hashing.'],
    });
    expect(record?.tallies).toHaveLength(1);
    // The lessons' cost is part of the campaign's gold, in the record and on screen.
    expect(view(run.state).campaign?.ending?.lessonsGold).toEqual({ kind: 'exact', value: 30_000 });
    expect(run.ending()?.record).toBe('writing');

    run.gm({ type: 'recordWritten', path: '.ibitsa/campaigns/c/record.md' });
    expect(run.ending()).toMatchObject({
      record: 'written',
      recordPath: '.ibitsa/campaigns/c/record.md',
      councilTokens: 9_500,
    });
    // A late or stray event changes nothing.
    event({ type: 'error', message: 'late' });
    run.feed({ kind: 'lessons', t: 0, lessonsId: 'other', event: { type: 'usage', totalCost: 1 } });
    expect(run.ending()?.record).toBe('written');
  });

  it('writes the record without lessons when the elder fails, and says when writing fails', () => {
    const run = reviewed();
    run.do({ type: 'finishQuest' });
    const lessonsId = run.last('startLessons')?.lessonsId ?? '';
    run.feed({
      kind: 'lessons',
      t: 0,
      lessonsId,
      event: { type: 'error', message: 'out of gold' },
    });
    expect(run.last('writeRecord')?.record.lessons).toBeNull();
    run.gm({ type: 'recordFailed', message: 'EACCES' });
    expect(run.ending()).toMatchObject({ record: 'failed', recordError: 'EACCES' });
  });

  it('after Finish, the user chooses what happens to the council context, once', () => {
    const run = reviewed();
    run.do({ type: 'chooseCouncilContext', choice: 'keep' });
    expect(run.rejections()).toEqual(['There is no council context to choose for.']);
    run.do({ type: 'finishQuest' });
    run.do({ type: 'chooseCouncilContext', choice: 'keep' });
    expect(run.last('councilContext')).toEqual({
      type: 'councilContext',
      choice: 'keep',
      sessionId: 'council-1',
    });
    expect(run.ending()?.councilContext).toBe('keep');
    run.do({ type: 'chooseCouncilContext', choice: 'empty' });
    expect(run.rejections()).toHaveLength(2);
  });

  it('on Abandon, writes the record marked abandoned and empties the council context without asking', () => {
    const run = new Run().started();
    run.submit().review(BLOCK);
    run.effects = [];
    run.do({ type: 'abandonQuest' });
    expect(run.last('councilContext')).toEqual({
      type: 'councilContext',
      choice: 'empty',
      sessionId: null,
    });
    expect(run.ending()?.councilContext).toBeNull();
    const lessonsId = run.last('startLessons')?.lessonsId ?? '';
    run.feed({ kind: 'lessons', t: 0, lessonsId, event: { type: 'usage', totalCost: 10_000 } });
    expect(run.last('writeRecord')?.record).toMatchObject({
      status: 'abandoned',
      deferred: { unfinished: ['Sign-in: Task T1', 'Sign-in: Task T2'] },
    });
  });

  it('writes a quick quest’s record straight away: nothing reviewed, no council', () => {
    const run = new Run();
    run.gm({ type: 'questSettings', ...DEFAULT_SETTINGS });
    run.do({
      type: 'startQuest',
      description: 'Fix it',
      heroName: 'Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    run.gm({
      type: 'worktreeCreated',
      islandId: run.state.islands[0]?.id ?? '',
      path: '/wt',
      branch: 'b',
    });
    run.agent({ type: 'sessionStarted', sessionId: 's' });
    run.submit();
    run.do({ type: 'finishQuest' });
    expect(run.last('startLessons')).toBeUndefined();
    expect(run.last('writeRecord')?.record).toMatchObject({
      summary: null,
      decisions: [],
      lessons: null,
    });
    expect(run.ending()).toMatchObject({
      record: 'writing',
      councilContext: null,
      councilTokens: null,
      lessonsGold: { kind: 'exact', value: 0 },
    });
  });

  it('lists the revisit requests the user dismissed as deferred', () => {
    const run = new Run().started();
    run.submit().review({
      verdict: 'pass',
      findings: [{ severity: 'suggestion', message: 'Reconsider methods', revisit: 'D1' }],
    });
    const item = view(run.state).needsYou.find((i) => i.kind === 'revisitDecision');
    run.do({ type: 'dismissItem', itemId: item?.id ?? '' });
    run.submit().checks();
    run.do({ type: 'finishQuest' });
    const lessonsId = run.last('startLessons')?.lessonsId ?? '';
    run.feed({ kind: 'lessons', t: 0, lessonsId, event: { type: 'usage', totalCost: 1 } });
    expect(run.last('writeRecord')?.record.deferred.revisits).toEqual([
      { councillorId: 'security', decisionId: 'D1', message: 'Reconsider methods' },
    ]);
  });
});
