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
const PASS: Verdict = { verdict: 'pass', findings: [] };
const changes = (message: string): Verdict => ({
  verdict: 'changes',
  findings: [
    {
      severity: 'blocking',
      criterion: 'Passwords are hashed',
      file: 'src/auth.ts',
      line: 3,
      message,
    },
  ],
});
const PLAN: Partial<Plan> = {
  tasks: [
    task('T1', {
      criteria: [
        { councillorId: 'security', items: ['Passwords are hashed'] },
        { councillorId: 'tester', items: ['It has a test'] },
      ],
      decisions: ['D1'],
    }),
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
    return this.feed({ kind: 'agent', t: 0, heroId: this.hero().id, event });
  }
  /** A campaign with reviews on, one island with T1 (reviewed by security and tester) then T2, started. */
  started(settings: Partial<CoreState['settings']> = {}, plan: Partial<Plan> = PLAN): this {
    this.gm({ type: 'questSettings', ...DEFAULT_SETTINGS, reviews: true, ...settings });
    this.do({
      type: 'conveneCouncil',
      task: 'Sign-in',
      mode: 'roundTable',
      roster: ['security', 'tester'],
      effort: 'light',
    });
    const sittingId = this.state.sitting?.id ?? '';
    for (const councillorId of ['security', 'tester']) {
      this.feed({
        kind: 'council',
        t: 0,
        sittingId,
        event: { type: 'reportFiled', toolUseId: councillorId, councillorId, report: REPORT },
      });
    }
    const full: Plan = {
      summary: 'Plan',
      goal: 'Sign-in',
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
    this.do({ type: 'approvePlan', version: 1 });
    this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: [
        {
          islandId: 'I1',
          heroName: 'Ilse',
          classId: 'ranger',
          reviewEfforts: { security: 'deep' },
        },
      ],
    });
    const island = this.state.islands[0];
    this.gm({
      type: 'worktreeCreated',
      islandId: island?.id ?? '',
      path: '/wt',
      branch: island?.branch ?? '',
    });
    return this.agent({ type: 'sessionStarted', sessionId: 's' });
  }
  hero() {
    const hero = this.state.heroes[0];
    if (!hero) throw new Error('no hero');
    return hero;
  }
  task(n = 0) {
    const tp = this.state.islands[0]?.taskPoints[n];
    if (!tp) throw new Error('no task');
    return tp;
  }
  submit(head: string): this {
    const id = `sub${++this.n}`;
    this.agent({ type: 'taskSubmitted', toolUseId: id, summary: 'Done' });
    this.gm({ type: 'submitChecked', heroId: this.hero().id, toolUseId: id, ok: true, head });
    return this.agent({ type: 'turnEnded', queuedTurns: 0 });
  }
  checks(ok = true): this {
    return this.gm({
      type: 'checksRan',
      taskPointId: this.task(
        this.state.islands[0]?.taskPoints.findIndex((t) => t.state === 'underReview'),
      ).id,
      results: [{ command: 'pnpm test', ok, output: ok ? 'all good' : '1 failing: login' }],
    });
  }
  reviews(): Extract<Effect, { type: 'startReview' }>[] {
    return this.effects.flatMap((e) => (e.type === 'startReview' ? [e] : []));
  }
  verdict(reviewId: string, verdict: unknown): this {
    return this.feed({
      kind: 'review',
      t: 0,
      reviewId,
      event: { type: 'verdictSubmitted', toolUseId: `v-${reviewId}`, verdict: verdict as Verdict },
    });
  }
  messages(): string[] {
    return this.effects.flatMap((e) => (e.type === 'sendMessage' ? [e.text] : []));
  }
  state_(): string {
    return view(this.state).heroes[0]?.state.kind ?? '';
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

describe('the review loop (spec §5.5, M5)', () => {
  it('runs the checks on a submitted task while the hero waits under review', () => {
    const run = new Run().started();
    run.effects = [];
    run.submit('abc123');
    expect(run.task().state).toBe('underReview');
    expect(run.task().submitHead).toBe('abc123');
    expect(run.state_()).toBe('underReview');
    // The turn that handed it in ends under review: the hero isn't waiting for orders (#141).
    expect(run.state.needsYou.map((i) => i.kind)).not.toContain('reply');
    expect(run.effects).toContainEqual({
      type: 'runChecks',
      taskPointId: run.task().id,
      worktreePath: '/wt',
    });
    expect(view(run.state).islands[0]?.taskPoints[0]?.review).toMatchObject({
      round: 1,
      phase: 'checks',
    });
  });

  it('sends a failed check straight back to the hero, without a reviewer', () => {
    const run = new Run().started().submit('abc');
    run.effects = [];
    run.checks(false);
    expect(run.task().state).toBe('active');
    expect(run.reviews()).toEqual([]);
    expect(run.messages()[0]).toContain('The check `pnpm test` failed:\n\n1 failing: login');
    run.submit('def');
    expect(run.effects).toContainEqual(expect.objectContaining({ type: 'runChecks' }));
  });

  it('starts every councillor with criteria at once, with the task, its commits, criteria, decisions and effort', () => {
    const run = new Run().started().submit('abc').checks();
    expect(run.reviews().map((r) => [r.councillorId, r.effort, r.round])).toEqual([
      ['security', 'deep', 1],
      ['tester', 'light', 1],
    ]);
    expect(run.reviews()[0]).toMatchObject({
      worktreePath: '/wt',
      from: 'main',
      to: 'abc',
      since: null,
      task: { title: 'Task T1', description: 'Do T1.' },
      criteria: ['Passwords are hashed'],
      decisions: [expect.objectContaining({ id: 'D1' })],
      checks: [{ command: 'pnpm test', ok: true, output: 'all good' }],
    });
    expect(view(run.state).islands[0]?.taskPoints[0]?.review?.phase).toBe('reviewing');
  });

  it('turns back a verdict that blocks without a reason, or disagrees with its findings', () => {
    const run = new Run().started().submit('abc').checks();
    const [security] = run.reviews();
    run.effects = [];
    run.verdict(security?.reviewId ?? '', {
      verdict: 'changes',
      findings: [{ severity: 'blocking', message: 'Not great' }],
    });
    expect(run.effects[0]).toMatchObject({
      type: 'completeReviewTool',
      accepted: false,
      reason: expect.stringContaining('a blocking finding needs the criterion it fails, or a kind'),
    });
    run.verdict(security?.reviewId ?? '', { verdict: 'changes', findings: [] });
    expect(run.effects.at(-1)).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('needs a blocking finding'),
    });
  });

  it('passes the task when every reviewer passes, keeps suggestions, and hands the hero its next task', () => {
    const run = new Run().started().submit('abc').checks();
    const [security, tester] = run.reviews();
    run.feed({
      kind: 'review',
      t: 0,
      reviewId: security?.reviewId ?? '',
      event: { type: 'usage', totalCost: 50_000 },
    });
    run.verdict(security?.reviewId ?? '', PASS);
    expect(run.task().state).toBe('underReview');
    run.effects = [];
    run.verdict(tester?.reviewId ?? '', {
      verdict: 'pass',
      findings: [{ severity: 'suggestion', message: 'Name it better', revisit: 'D1' }],
    });
    expect(run.task().state).toBe('done');
    expect(run.task(1).state).toBe('active');
    expect(run.messages()[0]).toContain('Do T2.');
    const review = view(run.state).islands[0]?.taskPoints[0]?.review;
    expect(review?.phase).toBe('passed');
    expect(review?.suggestions).toEqual([
      { severity: 'suggestion', message: 'Name it better', revisit: 'D1', councillorId: 'tester' },
    ]);
    expect(review?.reviews.map((r) => r.status)).toEqual(['done', 'done']);
    expect(run.effects.filter((e) => e.type === 'closeReview')).toHaveLength(1);
    // The campaign's gold counts reviewers too (once the hero has reported its own).
    run.agent({ type: 'usage', totalCost: 10_000 });
    expect(view(run.state).campaign?.gold).toMatchObject({ value: 60_000 });
    const revisit = view(run.state).needsYou.find((i) => i.kind === 'revisitDecision');
    expect(revisit).toMatchObject({
      councillorId: 'tester',
      decisionId: 'D1',
      message: 'Name it better',
    });
    run.do({ type: 'dismissItem', itemId: revisit?.id ?? '' });
    expect(view(run.state).needsYou.filter((i) => i.kind === 'revisitDecision')).toEqual([]);
    run.do({ type: 'dismissItem', itemId: 'nope' });
    expect(run.rejections()).toEqual(["That item can't be dismissed."]);
  });

  it('sends blocking findings back, and only the councillor who raised them reviews again, on what changed', () => {
    const run = new Run().started().submit('abc').checks();
    const [security, tester] = run.reviews();
    run.verdict(tester?.reviewId ?? '', PASS);
    run.effects = [];
    run.verdict(security?.reviewId ?? '', changes('Uses MD5'));
    expect(run.task().state).toBe('active');
    expect(run.messages()[0]).toContain(
      '- security, criterion "Passwords are hashed" (src/auth.ts:3): Uses MD5',
    );
    expect(run.messages()[0]).toContain(`Uses MD5 [review ${security?.reviewId}]`);
    expect(run.messages()[0]).toContain('call dispute_finding with their review ids instead');
    expect(view(run.state).islands[0]?.taskPoints[0]?.review).toMatchObject({
      round: 2,
      phase: 'changes',
    });
    run.effects = [];
    run.submit('def').checks();
    expect(run.reviews().map((r) => [r.councillorId, r.since, r.to, r.round])).toEqual([
      ['security', 'abc', 'def', 2],
    ]);
    run.verdict(run.reviews()[0]?.reviewId ?? '', PASS);
    expect(run.task().state).toBe('done');
  });

  it('goes to the user after the loop limit: accept anyway, send back with a note, or stop', () => {
    const fail = (run: Run) => {
      const [security, tester] = run.reviews().slice(-2);
      if (tester?.councillorId === 'tester') run.verdict(tester.reviewId, PASS);
      run.verdict(
        (security?.councillorId === 'security' ? security : run.reviews().at(-1))?.reviewId ?? '',
        changes('Still MD5'),
      );
    };
    const run = new Run().started({ loopLimit: 2 }).submit('a').checks();
    fail(run);
    run.submit('b').checks();
    run.verdict(run.reviews().at(-1)?.reviewId ?? '', changes('Still MD5'));
    expect(run.state_()).toBe('underReview');
    const item = view(run.state).needsYou.find((i) => i.kind === 'reviewEscalation');
    expect(item).toMatchObject({
      reason: 'loopLimit',
      findings: [expect.objectContaining({ councillorId: 'security', message: 'Still MD5' })],
    });
    run.effects = [];
    run.do({
      type: 'resolveReview',
      itemId: item?.id ?? '',
      decision: 'sendBack',
      note: 'Use bcrypt',
    });
    expect(run.messages()[0]).toContain('The user adds: Use bcrypt');
    run.submit('c').checks();
    run.verdict(run.reviews().at(-1)?.reviewId ?? '', changes('Still MD5'));
    const again = view(run.state).needsYou.find((i) => i.kind === 'reviewEscalation');
    run.do({ type: 'resolveReview', itemId: again?.id ?? '', decision: 'accept' });
    expect(run.task().state).toBe('done');
    run.do({ type: 'resolveReview', itemId: again?.id ?? '', decision: 'accept' });
    expect(run.rejections()).toEqual(['That review is no longer waiting.']);
  });

  it("goes to the user when a reviewer can't finish, and can stop the hero", () => {
    const run = new Run().started().submit('a').checks();
    const [security, tester] = run.reviews();
    run.verdict(tester?.reviewId ?? '', PASS);
    run.feed({
      kind: 'review',
      t: 0,
      reviewId: security?.reviewId ?? '',
      event: { type: 'sessionStarted', sessionId: 'x' },
    });
    run.feed({
      kind: 'review',
      t: 0,
      reviewId: security?.reviewId ?? '',
      event: { type: 'error', message: 'out of gold' },
    });
    const item = view(run.state).needsYou.find((i) => i.kind === 'reviewEscalation');
    expect(item).toMatchObject({ reason: 'reviewFailed' });
    expect(view(run.state).islands[0]?.taskPoints[0]?.review?.reviews[0]).toMatchObject({
      status: 'failed',
      error: 'out of gold',
    });
    run.effects = [];
    run.do({ type: 'resolveReview', itemId: item?.id ?? '', decision: 'stop' });
    expect(run.effects).toContainEqual({ type: 'interrupt', heroId: run.hero().id });
    // A late verdict for a review that has ended is turned down.
    run.verdict(security?.reviewId ?? '', PASS);
    expect(run.effects.at(-1)).toMatchObject({ accepted: false, reason: 'This review has ended.' });
  });

  it("puts the hero's dispute to the user: dropping the findings lets the task through without that reviewer", () => {
    const run = new Run().started().submit('a').checks();
    const [security, tester] = run.reviews();
    run.verdict(tester?.reviewId ?? '', PASS);
    run.verdict(security?.reviewId ?? '', changes('Use MD5'));
    run.agent({
      type: 'findingDisputed',
      reviewIds: [security?.reviewId ?? ''],
      reason: 'D1 chose email; this contradicts it',
    });
    const item = view(run.state).needsYou.find((i) => i.kind === 'dispute');
    expect(item).toMatchObject({
      reason: 'D1 chose email; this contradicts it',
      findings: [expect.objectContaining({ message: 'Use MD5' })],
    });
    run.effects = [];
    run.do({
      type: 'resolveDispute',
      itemId: item?.id ?? '',
      decision: 'drop',
      note: 'Right call',
    });
    expect(run.messages()[0]).toBe(
      'The user dropped the disputed findings: ignore them.\n\nRight call',
    );
    run.effects = [];
    run.submit('b').checks();
    expect(run.reviews()).toEqual([]);
    expect(run.task().state).toBe('done');
  });

  it('keeps disputed findings when the user says so', () => {
    const run = new Run().started().submit('a').checks();
    const [security, tester] = run.reviews();
    run.verdict(tester?.reviewId ?? '', PASS);
    run.verdict(security?.reviewId ?? '', changes('Use MD5'));
    run.agent({
      type: 'findingDisputed',
      reviewIds: [security?.reviewId ?? ''],
      reason: 'Disagree',
    });
    const item = view(run.state).needsYou.find((i) => i.kind === 'dispute');
    run.effects = [];
    run.do({ type: 'resolveDispute', itemId: item?.id ?? '', decision: 'keep' });
    expect(run.messages()[0]).toBe('The user keeps the disputed findings: address them.');
    run.do({ type: 'resolveDispute', itemId: item?.id ?? '', decision: 'keep' });
    expect(run.rejections()).toEqual(['That dispute is no longer waiting.']);
  });

  it('passes a task without reviewers once its checks pass (a quick quest, or a task without criteria)', () => {
    const run = new Run()
      .started({}, { tasks: [task('T1')], decisions: [] })
      .submit('a')
      .checks();
    expect(run.reviews()).toEqual([]);
    expect(run.state_()).toBe('submitted');
    expect(run.task().state).toBe('done');
  });

  it("makes a task that depends on another wait until it passes review, not just until it's submitted", () => {
    const run = new Run();
    run.gm({ type: 'questSettings', ...DEFAULT_SETTINGS, reviews: true });
    run.do({
      type: 'conveneCouncil',
      task: 'x',
      mode: 'roundTable',
      roster: ['tester'],
      effort: 'light',
    });
    const sid = run.state.sitting?.id ?? '';
    run.feed({
      kind: 'council',
      t: 0,
      sittingId: sid,
      event: { type: 'reportFiled', toolUseId: 'r', councillorId: 'tester', report: REPORT },
    });
    const plan: Plan = {
      summary: 'P',
      goal: 'G',
      tasks: [
        task('T1', { criteria: [{ councillorId: 'tester', items: ['tested'] }] }),
        task('T2', { dependsOn: ['T1'] }),
      ],
      decisions: [],
      islands: [
        { id: 'I1', title: 'One', tasks: ['T1'] },
        { id: 'I2', title: 'Two', tasks: ['T2'] },
      ],
    };
    run.feed({
      kind: 'council',
      t: 0,
      sittingId: sid,
      event: { type: 'planProposed', toolUseId: 'p', plan },
    });
    run.do({ type: 'approvePlan', version: 1 });
    run.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: ['I1', 'I2'].map((islandId) => ({ islandId, heroName: islandId, classId: 'rogue' })),
    });
    const one = run.state.islands[0];
    run.gm({
      type: 'worktreeCreated',
      islandId: one?.id ?? '',
      path: '/wt',
      branch: one?.branch ?? '',
    });
    run.agent({ type: 'sessionStarted', sessionId: 's' });
    run.submit('a').checks();
    expect(view(run.state).islands[1]?.worktree).toBe('waiting');
    run.verdict(run.reviews()[0]?.reviewId ?? '', PASS);
    expect(view(run.state).islands[1]?.worktree).toBe('creating');
  });
});
