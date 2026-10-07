import type { AgentEvent, Command, Cue, Plan, PlanTask, PullRequestState } from '@ibitsa/protocol';
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
    task('T1', {
      criteria: [{ councillorId: 'security', items: ['Passwords are hashed'] }],
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
    {
      id: 'D2',
      title: 'Elsewhere',
      raisedBy: 'elder',
      chosen: 'No',
      alternatives: [],
      why: 'Unrelated',
      affects: [],
    },
  ],
};
const STACKED: Plan = {
  ...PLAN,
  islands: [
    { id: 'I1', title: 'Backend', tasks: ['T1'] },
    { id: 'I2', title: 'Frontend', tasks: ['T2'] },
  ],
  branching: 'stacked',
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
  agent(event: AgentEvent, hero = 0): this {
    return this.feed({ kind: 'agent', t: 0, heroId: this.state.heroes[hero]?.id ?? '', event });
  }
  /** A planned campaign with its islands' worktrees ready and heroes started. */
  started({ plan = PLAN, reviews = false } = {}): this {
    this.gm({ type: 'questSettings', ...DEFAULT_SETTINGS, reviews, maxParallel: 3 });
    this.do({
      type: 'conveneCouncil',
      task: 'Sign-in',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'light',
    });
    const sittingId = this.state.sitting?.id ?? '';
    this.feed({
      kind: 'council',
      t: 0,
      sittingId,
      event: { type: 'reportFiled', toolUseId: 'r', councillorId: 'security', report: REPORT },
    });
    this.feed({
      kind: 'council',
      t: 0,
      sittingId,
      event: { type: 'planProposed', toolUseId: 'p', plan },
    });
    this.do({ type: 'approvePlan', version: 1 });
    this.do({
      type: 'startCampaign',
      baseRef: 'main',
      ...(plan.branching === 'stacked' ? { stackedStart: 'together' } : {}),
      parties: (plan.islands ?? [{ id: 'I1' }]).map((i, n) => ({
        islandId: i.id,
        heroName: `Hero ${n}`,
        classId: 'ranger',
      })),
    });
    this.state.islands.forEach((island, n) => {
      this.gm({
        type: 'worktreeCreated',
        islandId: island.id,
        path: `/wt${n}`,
        branch: island.branch,
      });
      this.agent({ type: 'sessionStarted', sessionId: `s${n}` }, n);
    });
    return this;
  }
  /** The hero hands in its current task, the submit check passes, and its turn ends. */
  submit(hero = 0): this {
    const id = `sub${++this.n}`;
    const heroId = this.state.heroes[hero]?.id ?? '';
    this.agent({ type: 'taskSubmitted', toolUseId: id, summary: 'Done' }, hero);
    this.gm({ type: 'submitChecked', heroId, toolUseId: id, ok: true, head: `h${this.n}` });
    return this.agent({ type: 'turnEnded', queuedTurns: 0 }, hero);
  }
  island(n = 0) {
    const island = this.state.islands[n];
    if (!island) throw new Error('no island');
    return island;
  }
  snap(n = 0) {
    const island = view(this.state).islands[n];
    if (!island) throw new Error('no island');
    return island;
  }
  last<T extends Effect['type']>(type: T): Extract<Effect, { type: T }> | undefined {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type).at(-1);
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

const opened = (
  islandId: string,
  { number = 7, state = 'draft' }: { number?: number; state?: PullRequestState } = {},
) => ({
  type: 'pullRequestOpened' as const,
  islandId,
  head: 'abc',
  number,
  url: `https://github.com/o/r/pull/${number}`,
  state,
});

describe('pull requests (spec §5.6, M6)', () => {
  it('opens a draft before the island is cleared, and refuses one ready for review', () => {
    const run = new Run().started();
    const island = run.island();
    expect(run.snap().pullRequestDraft).toMatchObject({
      title: island.name,
      base: 'main',
      draft: true,
      cleared: false,
      cannotOpen: null,
    });

    run.do({
      type: 'openPullRequest',
      islandId: island.id,
      title: 'Sign-in',
      body: 'B',
      draft: false,
    });
    expect(run.rejections()).toEqual([
      'Open it as a draft until every task on the island has passed.',
    ]);

    run.do({
      type: 'openPullRequest',
      islandId: island.id,
      title: 'Sign-in',
      body: 'B',
      draft: true,
    });
    expect(run.last('openPullRequest')).toEqual({
      type: 'openPullRequest',
      islandId: island.id,
      worktreePath: '/wt0',
      branch: island.branch,
      base: 'main',
      title: 'Sign-in',
      body: 'B',
      draft: true,
    });
    expect(run.snap().remote).toMatchObject({ busy: 'opening', pullRequest: null });
    run.do({ type: 'pushBranch', islandId: island.id });
    expect(run.rejections().at(-1)).toBe('Wait for the push to finish.');

    run.gm(opened(island.id));
    expect(run.snap().remote).toEqual({
      pushedHead: 'abc',
      busy: null,
      error: null,
      pullRequest: {
        number: 7,
        url: 'https://github.com/o/r/pull/7',
        state: 'draft',
        base: 'main',
      },
    });
    expect(run.snap().pullRequestDraft).toBeNull();
    expect(run.last('watchPullRequests')).toEqual({ type: 'watchPullRequests', numbers: [7] });
    // A draft doesn't end the hero's work.
    expect(run.state.heroes[0]?.sessionLive).toBe(true);
    run.do({ type: 'openPullRequest', islandId: island.id, title: 'Again', body: '', draft: true });
    expect(run.rejections().at(-1)).toBe('This island already has a pull request.');
  });

  it('marks the draft ready once the island is cleared, and the hero session ends', () => {
    const run = new Run().started();
    const id = run.island().id;
    run.do({ type: 'openPullRequest', islandId: id, title: 'T', body: '', draft: true });
    run.gm(opened(id));
    run.do({ type: 'markPullRequestReady', islandId: id });
    expect(run.rejections()).toEqual(['Every task on the island has to pass first.']);

    run.submit().submit();
    expect(run.snap().taskPoints.map((t) => t.state)).toEqual(['doneUnreviewed', 'doneUnreviewed']);
    run.do({ type: 'markPullRequestReady', islandId: id });
    expect(run.last('markPullRequestReady')).toEqual({
      type: 'markPullRequestReady',
      islandId: id,
      worktreePath: '/wt0',
      branch: run.island().branch,
      number: 7,
    });
    run.gm({ type: 'pullRequestReady', islandId: id, head: 'def' });
    expect(run.snap().remote).toMatchObject({ pushedHead: 'def', pullRequest: { state: 'open' } });
    expect(run.last('closeSession')).toEqual({
      type: 'closeSession',
      heroId: run.state.heroes[0]?.id,
    });
    expect(run.state.heroes[0]?.sessionLive).toBe(false);
    run.do({ type: 'markPullRequestReady', islandId: id });
    expect(run.rejections().at(-1)).toBe('There is no draft pull request to mark ready.');
  });

  it('opening ready for review on a cleared island ends the session at once', () => {
    const run = new Run().started();
    const id = run.island().id;
    run.submit().submit();
    expect(run.snap().pullRequestDraft).toMatchObject({ draft: false, cleared: true });
    run.do({ type: 'openPullRequest', islandId: id, title: 'T', body: '', draft: false });
    run.gm(opened(id, { state: 'open' }));
    expect(run.state.heroes[0]?.sessionLive).toBe(false);
  });

  it('pushes the branch with or without a PR, and shows a failure until the next try', () => {
    const run = new Run().started();
    const id = run.island().id;
    run.do({ type: 'updatePullRequest', islandId: id });
    expect(run.rejections()).toEqual(['This island has no pull request yet.']);

    run.do({ type: 'pushBranch', islandId: id });
    expect(run.last('pushBranch')).toEqual({
      type: 'pushBranch',
      islandId: id,
      worktreePath: '/wt0',
      branch: run.island().branch,
    });
    run.gm({ type: 'remoteFailed', islandId: id, message: 'rejected: non-fast-forward' });
    expect(run.snap().remote).toMatchObject({ busy: null, error: 'rejected: non-fast-forward' });
    run.do({ type: 'pushBranch', islandId: id });
    expect(run.snap().remote).toMatchObject({ busy: 'pushing', error: null });
    run.gm({ type: 'branchPushed', islandId: id, head: 'f00' });
    expect(run.snap().remote).toMatchObject({ busy: null, pushedHead: 'f00', pullRequest: null });

    run.do({ type: 'pushBranch', islandId: 'nope' });
    expect(run.rejections().at(-1)).toBe('No such island.');
  });

  it('opens stacked PRs in order, each onto the island before', () => {
    const run = new Run().started({ plan: STACKED });
    const [first, second] = [run.island(0), run.island(1)];
    expect(run.snap(1).pullRequestDraft).toMatchObject({
      base: first.branch,
      cannotOpen: 'Open the pull request of Backend first.',
    });
    run.do({ type: 'openPullRequest', islandId: second.id, title: 'F', body: '', draft: true });
    expect(run.rejections()).toEqual(['Open the pull request of Backend first.']);

    run.do({ type: 'openPullRequest', islandId: first.id, title: 'B', body: '', draft: true });
    run.gm(opened(first.id, { number: 1 }));
    expect(run.snap(1).pullRequestDraft?.cannotOpen).toBeNull();
    run.do({ type: 'openPullRequest', islandId: second.id, title: 'F', body: '', draft: true });
    expect(run.last('openPullRequest')).toMatchObject({
      base: first.branch,
      branch: second.branch,
    });
    run.gm(opened(second.id, { number: 2 }));
    expect(run.snap(1).remote?.pullRequest?.base).toBe(first.branch);
    expect(run.last('watchPullRequests')?.numbers).toEqual([1, 2]);
  });

  it('follows polled states, stops watching settled PRs, and ships when every PR is merged', () => {
    const run = new Run().started({ plan: STACKED });
    run.do({
      type: 'openPullRequest',
      islandId: run.island(0).id,
      title: 'B',
      body: '',
      draft: true,
    });
    run.gm(opened(run.island(0).id, { number: 1 }));
    run.do({
      type: 'openPullRequest',
      islandId: run.island(1).id,
      title: 'F',
      body: '',
      draft: true,
    });
    run.gm(opened(run.island(1).id, { number: 2 }));

    run.effects = [];
    run.gm({
      type: 'pullRequestsPolled',
      pullRequests: [
        { number: 1, state: 'approved' },
        { number: 2, state: 'checksFailing' },
        { number: 99, state: 'merged' },
      ],
    });
    expect([run.snap(0), run.snap(1)].map((i) => i.remote?.pullRequest?.state)).toEqual([
      'approved',
      'checksFailing',
    ]);
    expect(run.last('watchPullRequests')).toBeUndefined();

    run.gm({ type: 'pullRequestsPolled', pullRequests: [{ number: 1, state: 'merged' }] });
    expect(run.last('watchPullRequests')?.numbers).toEqual([2]);
    expect(view(run.state).campaign?.shipped).toBe(false);
    run.do({ type: 'refreshPullRequests' });
    expect(run.last('pollPullRequests')).toEqual({ type: 'pollPullRequests', numbers: [2] });
    run.do({ type: 'updatePullRequest', islandId: run.island(0).id });
    expect(run.rejections()).toEqual(['Its pull request is merged.']);

    run.gm({ type: 'pullRequestsPolled', pullRequests: [{ number: 2, state: 'merged' }] });
    expect(run.last('watchPullRequests')?.numbers).toEqual([]);
    expect(view(run.state).campaign?.shipped).toBe(true);
    run.do({ type: 'refreshPullRequests' });
    expect(run.rejections().at(-1)).toBe('There is no open pull request to refresh.');
  });

  it('stops polling when the quest ends; its PRs are followed on the git host from then on', () => {
    const run = new Run().started();
    run.do({
      type: 'openPullRequest',
      islandId: run.island().id,
      title: 'B',
      body: '',
      draft: true,
    });
    run.gm(opened(run.island().id));
    run.effects = [];
    run.do({ type: 'abandonQuest' });
    expect(run.last('watchPullRequests')).toEqual({ type: 'watchPullRequests', numbers: [] });
  });

  it('after a restart, polls again and drops a push that was under way', () => {
    const run = new Run().started({ plan: STACKED });
    run.do({
      type: 'openPullRequest',
      islandId: run.island(0).id,
      title: 'B',
      body: '',
      draft: true,
    });
    run.gm(opened(run.island(0).id, { number: 1 }));
    run.do({ type: 'pushBranch', islandId: run.island(1).id });
    run.effects = [];
    run.gm({ type: 'runtimeRestarted' });
    expect(run.last('watchPullRequests')?.numbers).toEqual([1]);
    expect(run.snap(1).remote).toMatchObject({
      busy: null,
      error: 'Interrupted when VS Code reloaded. Try again.',
    });
  });

  it('builds the body from the plan, the criteria, the decisions, the kept suggestions, the checks and the reviews', () => {
    const run = new Run().started({ reviews: true });
    run.submit();
    const taskId = run.island().taskPoints[0]?.id ?? '';
    run.gm({
      type: 'checksRan',
      taskPointId: taskId,
      results: [{ command: 'pnpm test', ok: true, output: '' }],
    });
    const review = run.last('startReview');
    run.feed({
      kind: 'review',
      t: 0,
      reviewId: review?.reviewId ?? '',
      event: {
        type: 'verdictSubmitted',
        toolUseId: 'v',
        verdict: {
          verdict: 'pass',
          findings: [
            { severity: 'suggestion', file: 'src/a.ts', line: 4, message: 'Name it better' },
          ],
        },
      },
    });
    expect(run.snap().pullRequestDraft?.body).toBe(
      [
        'Email sign-in.',
        '## Tasks\n\n- [x] Task T1\n- [ ] Task T2',
        '## Acceptance criteria\n\n- **Task T1**, reviewed by security:\n  - Passwords are hashed',
        '## Decisions\n\n- **D1 Methods:** Email. Simple',
        '## Kept for this pull request\n\n- security (`src/a.ts:4`): Name it better',
        '## Checks\n\n- `pnpm test`: passed',
        '## Review\n\n- Task T1: passed after round 1 (security)',
      ].join('\n\n'),
    );
  });

  it('gives a quick quest a PR whose body is its task', () => {
    const run = new Run();
    run.gm({ type: 'questSettings', ...DEFAULT_SETTINGS });
    run.do({
      type: 'startQuest',
      description: 'Fix the redirect\nIt loops.',
      heroName: 'Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    expect(run.snap().pullRequestDraft).toBeNull();
    run.gm({
      type: 'worktreeCreated',
      islandId: run.island().id,
      path: '/wt',
      branch: 'ibitsa/fix',
    });
    expect(run.snap().pullRequestDraft).toMatchObject({
      title: 'Fix the redirect',
      base: 'main',
      body: 'It loops.',
    });
  });

  it('brings PR comments to the hero: back to the last task, its session resumed, and reviewed again by everyone', () => {
    const run = new Run().started({
      reviews: true,
      plan: { ...PLAN, tasks: [PLAN.tasks[0] as PlanTask] },
    });
    const id = run.island().id;
    const passReview = () => {
      const taskId = run.island().taskPoints[0]?.id ?? '';
      run.gm({ type: 'checksRan', taskPointId: taskId, results: [] });
      const review = run.last('startReview');
      run.feed({
        kind: 'review',
        t: 0,
        reviewId: review?.reviewId ?? '',
        event: {
          type: 'verdictSubmitted',
          toolUseId: `v${review?.reviewId}`,
          verdict: { verdict: 'pass', findings: [] },
        },
      });
      return review;
    };
    run.submit();
    const first = passReview();
    expect(run.snap().taskPoints[0]?.state).toBe('done');
    run.do({ type: 'openPullRequest', islandId: id, title: 'T', body: '', draft: false });
    run.gm(opened(id, { state: 'open' }));
    expect(run.state.heroes[0]?.sessionLive).toBe(false);

    run.do({ type: 'bringPullRequestComments', islandId: id });
    expect(run.last('fetchPullRequestComments')).toEqual({
      type: 'fetchPullRequestComments',
      islandId: id,
      number: 7,
    });
    expect(run.snap().remote?.busy).toBe('fetchingComments');
    run.gm({ type: 'pullRequestComments', islandId: id, comments: [] });
    expect(run.snap().remote).toMatchObject({
      busy: null,
      error: 'The pull request has no review comments yet.',
    });

    run.effects = [];
    run.do({ type: 'bringPullRequestComments', islandId: id });
    run.gm({
      type: 'pullRequestComments',
      islandId: id,
      comments: [
        { author: 'ana', body: 'Rename it', path: 'src/a.ts', line: 4 },
        { author: 'bo', body: 'Looks good otherwise' },
      ],
    });
    expect(run.snap().taskPoints[0]?.state).toBe('active');
    expect(run.state.heroes[0]?.submitted).toBeNull();
    expect(run.last('resumeSession')).toMatchObject({ sessionId: 's0' });
    expect(run.last('sendMessage')?.text).toBe(
      'Review comments on pull request #7:\n\n- ana (src/a.ts:4): Rename it\n- bo: Looks good otherwise\n\nAddress them, commit, and call submit_task again. The user pushes your commits to the pull request.',
    );

    // Submitted again: the councillor reviews what changed since its passing review.
    run.submit();
    const taskId = run.island().taskPoints[0]?.id ?? '';
    run.effects = [];
    run.gm({ type: 'checksRan', taskPointId: taskId, results: [] });
    expect(run.last('startReview')).toMatchObject({
      councillorId: 'security',
      round: 2,
      since: first?.to,
    });
  });

  it('counts the loop limit from the round PR comments reopened', () => {
    const run = new Run().started({
      reviews: true,
      plan: { ...PLAN, tasks: [PLAN.tasks[0] as PlanTask] },
    });
    run.state.settings.loopLimit = 2;
    const id = run.island().id;
    const verdict = (verdict: 'pass' | 'changes') => {
      const taskId = run.island().taskPoints[0]?.id ?? '';
      run.gm({ type: 'checksRan', taskPointId: taskId, results: [] });
      const review = run.last('startReview');
      run.feed({
        kind: 'review',
        t: 0,
        reviewId: review?.reviewId ?? '',
        event: {
          type: 'verdictSubmitted',
          toolUseId: `v${review?.reviewId}`,
          verdict:
            verdict === 'pass'
              ? { verdict: 'pass', findings: [] }
              : {
                  verdict: 'changes',
                  findings: [{ severity: 'blocking', kind: 'bug', message: 'Off by one' }],
                },
        },
      });
    };
    run.submit();
    verdict('changes');
    run.submit();
    verdict('pass');
    run.do({ type: 'openPullRequest', islandId: id, title: 'T', body: '', draft: false });
    run.gm(opened(id, { state: 'open' }));
    run.do({ type: 'bringPullRequestComments', islandId: id });
    run.gm({
      type: 'pullRequestComments',
      islandId: id,
      comments: [{ author: 'ana', body: 'Rename it' }],
    });
    run.submit();
    verdict('changes');
    // Round 3 overall, but the first since the comments: sent back, not escalated.
    expect(view(run.state).needsYou.filter((i) => i.kind === 'reviewEscalation')).toEqual([]);
    expect(run.snap().taskPoints[0]?.state).toBe('active');
    run.submit();
    verdict('changes');
    expect(view(run.state).needsYou.map((i) => i.kind)).toContain('reviewEscalation');
  });

  it("won't bring comments without an open PR or a hero", () => {
    const run = new Run().started();
    const id = run.island().id;
    run.do({ type: 'bringPullRequestComments', islandId: id });
    run.do({ type: 'openPullRequest', islandId: id, title: 'T', body: '', draft: true });
    run.gm(opened(id));
    run.state.heroes = [];
    run.do({ type: 'bringPullRequestComments', islandId: id });
    expect(run.rejections()).toEqual([
      'There is no open pull request to read.',
      'No hero works on this island.',
    ]);
  });

  it('after an earlier stacked PR merges, retargets the next one and offers Restack', () => {
    const run = new Run().started({ plan: STACKED });
    const [first, second] = [run.island(0), run.island(1)];
    run.do({ type: 'openPullRequest', islandId: first.id, title: 'B', body: '', draft: true });
    run.gm({ ...opened(first.id, { number: 1 }), head: 'b-head' });
    run.do({ type: 'openPullRequest', islandId: second.id, title: 'F', body: '', draft: true });
    run.gm(opened(second.id, { number: 2 }));

    run.gm({ type: 'pullRequestsPolled', pullRequests: [{ number: 1, state: 'merged' }] });
    expect(run.last('retargetPullRequest')).toEqual({
      type: 'retargetPullRequest',
      islandId: second.id,
      number: 2,
      base: 'main',
    });
    expect(run.snap(1).remote).toMatchObject({
      busy: 'retargeting',
      restack: { onto: 'main', upstream: 'b-head', conflict: false },
    });
    run.gm({ type: 'pullRequestRetargeted', islandId: second.id, base: 'main' });
    expect(run.snap(1).remote).toMatchObject({ busy: null, pullRequest: { base: 'main' } });

    run.do({ type: 'restackIsland', islandId: second.id });
    expect(run.last('restack')).toEqual({
      type: 'restack',
      islandId: second.id,
      worktreePath: '/wt1',
      branch: second.branch,
      onto: 'main',
      upstream: 'b-head',
      push: true,
    });
    run.gm({ type: 'restacked', islandId: second.id, outcome: 'restacked', head: 'f-new' });
    expect(run.snap(1).remote).toMatchObject({ busy: null, restack: null, pushedHead: 'f-new' });
    run.do({ type: 'restackIsland', islandId: second.id });
    expect(run.rejections()).toEqual(['Nothing to restack.']);
  });

  it('asks the hero to resolve a restack that conflicts, and the next push is forced', () => {
    const run = new Run().started({ plan: STACKED });
    const [first, second] = [run.island(0), run.island(1)];
    run.do({ type: 'openPullRequest', islandId: first.id, title: 'B', body: '', draft: true });
    run.gm({ ...opened(first.id, { number: 1 }), head: 'b-head' });
    // The second island has no PR yet: its draft now targets main, with nothing to wait for.
    run.gm({ type: 'pullRequestsPolled', pullRequests: [{ number: 1, state: 'merged' }] });
    expect(run.last('retargetPullRequest')).toBeUndefined();
    expect(run.snap(1).pullRequestDraft).toMatchObject({ base: 'main', cannotOpen: null });

    run.do({ type: 'restackIsland', islandId: second.id });
    expect(run.last('restack')?.push).toBe(false);
    run.gm({ type: 'restacked', islandId: second.id, outcome: 'conflict', head: null });
    expect(run.snap(1).remote?.restack).toMatchObject({ conflict: true });
    expect(run.last('sendMessage')).toMatchObject({ heroId: run.state.heroes[1]?.id });
    expect(run.last('sendMessage')?.text).toContain('git rebase --onto origin/main b-head');
    run.do({ type: 'restackIsland', islandId: second.id });
    expect(run.rejections()).toEqual(['The hero is resolving the rebase; push it with Update PR.']);

    run.do({ type: 'pushBranch', islandId: second.id });
    expect(run.last('pushBranch')).toMatchObject({ force: true });
    run.gm({ type: 'branchPushed', islandId: second.id, head: 'f-fixed' });
    expect(run.snap(1).remote?.restack).toBeNull();
  });

  it("removes a merged island's worktree and local branch mid-campaign, and nothing else", () => {
    const run = new Run().started({ plan: STACKED });
    const [first, second] = [run.island(0), run.island(1)];
    run.do({ type: 'removeWorktree', islandId: first.id });
    expect(run.rejections()).toEqual([
      'Finish or abandon the quest first, or merge its pull request.',
    ]);
    run.do({ type: 'openPullRequest', islandId: first.id, title: 'B', body: '', draft: true });
    run.gm(opened(first.id, { number: 1 }));
    run.gm({ type: 'pullRequestsPolled', pullRequests: [{ number: 1, state: 'merged' }] });
    run.do({ type: 'removeWorktree', islandId: first.id });
    expect(run.last('removeWorktree')).toMatchObject({
      islandId: first.id,
      worktreePath: '/wt0',
      branch: first.branch,
    });
    expect(run.last('closeSession')).toEqual({
      type: 'closeSession',
      heroId: run.state.heroes[0]?.id,
    });
    expect(second.worktreePath).toBe('/wt1');
  });
});
