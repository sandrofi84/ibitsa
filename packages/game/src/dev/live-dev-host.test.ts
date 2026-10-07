import type { CoreMessage, Snapshot } from '@ibitsa/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDevHost, scriptedChecks, scriptedReview } from './live-dev-host';

const repo = { defaultBranch: 'main', branches: ['main'], uncommittedChanges: 0 };

function setup() {
  const host = new LiveDevHost({ credentialsReady: true, repo });
  const messages: CoreMessage[] = [];
  host.onMessage((m) => messages.push(m));
  const snapshot = (): Snapshot | undefined =>
    (messages.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot } | undefined)
      ?.snapshot;
  return { host, messages, snapshot, settle: () => vi.advanceTimersByTimeAsync(5_000) };
}

describe('LiveDevHost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('answers hello with welcome and a snapshot carrying the fake repo', async () => {
    const { host, messages, snapshot, settle } = setup();
    host.send({ type: 'hello', protocolVersion: 1 });
    await settle();
    expect(messages.map((m) => m.type)).toEqual(['welcome', 'snapshot']);
    expect(snapshot()?.repo).toEqual(repo);
  });

  it('plays a quest through the real core: start, message, stop, submit, finish, clean up', async () => {
    const { host, snapshot, settle } = setup();
    host.send({ type: 'hello', protocolVersion: 1 });
    host.send({
      type: 'startQuest',
      commandId: 'c1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    await settle();
    const hero = snapshot()?.heroes[0];
    expect(hero?.state.kind).toBe('idle');
    const heroId = hero?.id ?? '';

    host.send({
      type: 'sendMessage',
      commandId: 'c2',
      heroId,
      text: 'Add a test',
      priority: 'next',
    });
    await vi.advanceTimersByTimeAsync(130);
    expect(snapshot()?.heroes[0]?.state.kind).toBe('working');
    host.send({ type: 'stopHero', commandId: 'c3', heroId });
    await settle();
    expect(snapshot()?.heroes[0]?.state.kind).toBe('idle');

    host.send({ type: 'sendMessage', commandId: 'c4', heroId, text: 'submit it', priority: 'now' });
    await settle();
    expect(snapshot()?.heroes[0]?.state.kind).toBe('submitted');

    host.send({ type: 'finishQuest', commandId: 'c5' });
    await settle();
    expect(snapshot()?.campaign?.status).toBe('finished');
    const islandId = snapshot()?.islands[0]?.id ?? '';
    host.send({ type: 'removeWorktree', commandId: 'c6', islandId });
    await settle();
    expect(snapshot()?.needsYou).toEqual([]);
  });

  it('passes host requests to its fake channel', async () => {
    const { host, settle } = setup();
    const events: string[] = [];
    host.onHostEvent((e) => events.push(e.type));
    host.request({ channel: 'host', type: 'credentialsStatus' });
    await settle();
    expect(events).toEqual(['credentials']);
  });

  it('keeps a journal of the scripted quest and answers pages (#58)', async () => {
    const { host, messages, settle } = setup();
    host.send({ type: 'hello', protocolVersion: 1 });
    host.send({
      type: 'startQuest',
      commandId: 'c1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    await settle();
    expect(messages.some((m) => m.type === 'journalAppend')).toBe(true);
    host.send({ type: 'requestJournal' });
    await settle();
    const page = messages.filter((m) => m.type === 'journal').at(-1);
    expect(page?.type === 'journal' && page.entries[0]).toMatchObject({
      kind: 'event',
      text: 'Quest started: Fix the login redirect',
    });
  });

  it('asks permission to commit, offering always allow; keeps and forgets project rules (#62)', async () => {
    const { host, snapshot, settle } = setup();
    host.send({ type: 'hello', protocolVersion: 1 });
    host.send({
      type: 'startQuest',
      commandId: 'c1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    await settle();
    const heroId = snapshot()?.heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'c2', heroId, text: 'commit it', priority: 'now' });
    await settle();
    const item = snapshot()?.needsYou.find((i) => i.kind === 'permission');
    expect(item).toMatchObject({ alwaysAllow: ['Bash(git commit:*)'] });
    host.send({
      type: 'answerPermission',
      commandId: 'c3',
      itemId: item?.id ?? '',
      decision: 'allow',
      always: 'project',
    });
    await settle();
    expect(snapshot()?.projectRules).toEqual(['Bash(git commit:*)']);
    expect(snapshot()?.heroes[0]?.state.kind).toBe('idle');

    host.send({
      type: 'sendMessage',
      commandId: 'c4',
      heroId,
      text: 'commit again',
      priority: 'now',
    });
    await settle();
    const second = snapshot()?.needsYou.find((i) => i.kind === 'permission');
    host.send({
      type: 'answerPermission',
      commandId: 'c5',
      itemId: second?.id ?? '',
      decision: 'deny',
    });
    await settle();
    host.send({ type: 'forgetProjectRule', rule: 'Bash(git commit:*)' });
    await settle();
    expect(snapshot()?.projectRules).toEqual([]);
  });

  it('rests: the session compacts and the hero goes back to waiting for orders (#82)', async () => {
    const { host, snapshot, settle } = setup();
    host.send({ type: 'hello', protocolVersion: 1 });
    host.send({
      type: 'startQuest',
      commandId: 'c1',
      description: 'Fix the login redirect',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    await settle();
    const heroId = snapshot()?.heroes[0]?.id ?? '';
    host.send({ type: 'restHero', commandId: 'r', heroId });
    await vi.advanceTimersByTimeAsync(250);
    expect(snapshot()?.heroes[0]?.state.kind).toBe('resting');
    await settle();
    expect(snapshot()?.heroes[0]?.state.kind).toBe('idle');
    expect(snapshot()?.heroes[0]?.hp).toEqual({
      kind: 'exact',
      value: { used: 6_000, max: 200_000 },
    });
  });

  it('answers requestFiles with the demo worktree (#83)', async () => {
    const { host, messages, settle } = setup();
    host.send({ type: 'requestFiles', islandId: 'i2' });
    await settle();
    expect(messages.filter((m) => m.type === 'files')).toEqual([
      expect.objectContaining({ islandId: 'i2', paths: expect.arrayContaining(['src/app.ts']) }),
    ]);
  });

  it('answers the / menu with the built-ins (#84)', async () => {
    const { host, messages, settle } = setup();
    host.send({ type: 'requestActions' });
    await settle();
    const actions = messages.find((m) => m.type === 'actions');
    expect(actions?.type === 'actions' && actions.actions.length).toBeGreaterThan(0);
  });

  it('previews the built-ins (#85)', async () => {
    const { host, messages, settle } = setup();
    host.send({ type: 'requestPreview', name: 'pr', args: 'alice' });
    await settle();
    const preview = messages.find((m) => m.type === 'preview');
    expect(preview?.type === 'preview' && preview.preview.text).toContain('alice');
  });

  it('answers createAction too (#86)', async () => {
    const { host, messages, settle } = setup();
    host.send({
      type: 'createAction',
      name: 'pr-summary',
      description: 'Summarize',
      argumentHint: '[focus]',
      prompt: 'p',
      target: 'hero',
      scope: 'personal',
    });
    await settle();
    expect(messages.some((m) => m.type === 'actionCreated' && m.name === 'pr-summary')).toBe(true);
  });
});

describe('LiveDevHost: the elder and the council (#101, #103–#105)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function briefed() {
    const env = setup();
    env.host.send({ type: 'hello', protocolVersion: 1 });
    env.host.send({ type: 'consultElder', commandId: 'e1', task: 'Fix the login redirect' });
    await env.settle();
    return env;
  }

  it('lists the built-in councillors and asks how the council sits', async () => {
    const { snapshot } = await briefed();
    expect(snapshot()?.councillors?.map((c) => c.id)).toEqual(['architect', 'tester', 'security']);
    expect(snapshot()?.councilMode).toBe('ask');
  });

  it('researches, then briefs a quick quest; a task mentioning fail runs out of gold', async () => {
    const { snapshot } = await briefed();
    expect(snapshot()?.elder).toMatchObject({
      status: 'briefed',
      brief: { quickQuest: { recommended: true } },
    });
    const failing = setup();
    failing.host.send({ type: 'consultElder', commandId: 'e1', task: 'Make it fail' });
    await failing.settle();
    expect(failing.snapshot()?.elder).toMatchObject({ status: 'failed' });
  });

  it('holds a round table: reports, a question, "Why?", a plan, a revision, then a planned quest', async () => {
    const { host, snapshot, settle } = await briefed();
    host.send({
      type: 'conveneCouncil',
      commandId: 'k1',
      task: 'Fix the login redirect',
      mode: 'roundTable',
      roster: ['tester', 'security'],
      effort: 'light',
    });
    await settle();
    const questions = snapshot()?.sitting?.questions;
    const item = questions?.items[0];
    expect(item).toMatchObject({ councillorId: 'tester' });
    host.send({
      type: 'askCouncilWhy',
      commandId: 'w1',
      batchId: questions?.batchId ?? '',
      questionId: item?.id ?? '',
    });
    await settle();
    expect(snapshot()?.sitting?.dialogue.at(-1)).toMatchObject({ speaker: 'tester' });
    host.send({
      type: 'answerCouncil',
      commandId: 'a1',
      batchId: questions?.batchId ?? '',
      answers: { [item?.id ?? '']: { optionId: 'yes' } },
    });
    await settle();
    expect(snapshot()?.sitting).toMatchObject({ status: 'awaitingApproval' });
    host.send({ type: 'requestPlanChange', commandId: 'r1', version: 1, text: 'Smaller' });
    await settle();
    expect(snapshot()?.sitting?.plans.at(-1)?.plan.summary).toBe('Revised: Smaller');
    host.send({ type: 'approvePlan', commandId: 'p1', version: 2 });
    host.send({
      type: 'startCampaign',
      commandId: 'q1',
      baseRef: 'main',
      parties: [
        { islandId: 'I1', heroName: 'Ilse', classId: 'ranger' },
        { islandId: 'I2', heroName: 'Vex', classId: 'rogue' },
      ],
    });
    await settle();
    // Two islands: the second waits for the first island's task (#123).
    expect(snapshot()?.islands.map((i) => i.worktree)).toEqual(['ready', 'waiting']);
    expect(snapshot()?.heroes.map((h) => h.state.kind)).toEqual(['idle', 'blocked']);
    host.send({
      type: 'sendMessage',
      commandId: 'm1',
      heroId: snapshot()?.heroes[0]?.id ?? '',
      text: 'submit it',
      priority: 'now',
    });
    await settle();
    await settle();
    expect(snapshot()?.islands.map((i) => i.worktree)).toEqual(['ready', 'ready']);
    expect(snapshot()?.heroes.map((h) => h.state.kind)).toEqual(['submitted', 'idle']);
  });

  it('holds separate chambers too, its reports arriving one by one', async () => {
    const { host, snapshot, settle } = await briefed();
    host.send({
      type: 'conveneCouncil',
      commandId: 'k1',
      task: 'Fix the login redirect',
      mode: 'chambers',
      roster: ['tester', 'security'],
      effort: 'light',
      councillorEfforts: { tester: 'light', security: 'standard' },
    });
    await settle();
    await settle();
    expect(snapshot()?.sitting?.roster.every((c) => c.reported)).toBe(true);
    expect(snapshot()?.sitting?.questions).not.toBeNull();
  });
});

describe('LiveDevHost: a demo campaign of three islands (#124)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const states = (snapshot: () => import('@ibitsa/protocol').Snapshot | undefined) =>
    snapshot()?.heroes.map((h) =>
      h.state.kind === 'blocked' ? `blocked:${h.state.reason}` : h.state.kind,
    );

  it('separate: two parties work and the third waits for a slot', async () => {
    const { host, snapshot, settle } = setup();
    host.demoCampaign('separate');
    await settle();
    expect(snapshot()?.campaign).toMatchObject({ branching: 'separate', status: 'active' });
    expect(snapshot()?.islands.map((i) => i.worktree)).toEqual(['ready', 'ready', 'waiting']);
    expect(states(snapshot)?.[2]).toBe('blocked:slot');
  });

  it('stacked: the next island waits for the one before, and starts once it is cleared', async () => {
    const { host, snapshot, settle } = setup();
    host.demoCampaign('stacked');
    await settle();
    expect(snapshot()?.islands.map((i) => i.worktree)).toEqual(['ready', 'waiting', 'waiting']);
    expect(states(snapshot)?.slice(1)).toEqual([
      'blocked:previousIsland',
      'blocked:previousIsland',
    ]);
    const heroId = snapshot()?.heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'm', heroId, text: 'submit it', priority: 'now' });
    await settle();
    expect(snapshot()?.islands.map((i) => i.worktree)).toEqual(['ready', 'ready', 'waiting']);
  });
});

describe('LiveDevHost: demo reviews (#140)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('checks, then three councillors review; one sends it back, and the second round passes', async () => {
    const host = new LiveDevHost({ credentialsReady: true, repo, review: 'demo' });
    const messages: CoreMessage[] = [];
    host.onMessage((m) => messages.push(m));
    const snapshot = () =>
      (messages.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot }).snapshot;
    const review = () => snapshot().islands[0]?.taskPoints[0]?.review;
    host.demoCampaign('separate');
    await vi.advanceTimersByTimeAsync(5_000);
    const heroId = snapshot().heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'm', heroId, text: 'submit it', priority: 'now' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(review()?.phase).toBe('reviewing');
    expect(review()?.checks?.map((c) => c.ok)).toEqual([true]);
    expect(review()?.reviews.map((r) => [r.councillorId, r.status])).toEqual([
      ['security', 'running'],
      ['tester', 'running'],
      ['architect', 'running'],
    ]);
    expect(snapshot().heroes[0]?.state.kind).toBe('underReview');

    // Round 1: security asks for changes with two blocking findings; the hero fixes it and resubmits.
    await vi.advanceTimersByTimeAsync(6_000);
    const first = review()?.reviews.filter((r) => r.round === 1);
    expect(first?.map((r) => r.verdict?.verdict)).toEqual(['changes', 'pass', 'pass']);
    expect(first?.[0]?.verdict?.findings.filter((f) => f.severity === 'blocking')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(review()?.round).toBe(2);
    expect(
      review()
        ?.reviews.filter((r) => r.round === 2)
        .map((r) => r.councillorId),
    ).toEqual(['security']);
    expect(review()?.phase).toBe('passed');
    expect(snapshot().islands[0]?.taskPoints[0]?.state).toBe('done');
  });
});

describe('LiveDevHost: several heroes (#125)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts a campaign with that many heroes at the first hello, each on its own island', async () => {
    const host = new LiveDevHost({ credentialsReady: true, repo, heroes: 2 });
    const messages: CoreMessage[] = [];
    host.onMessage((m) => messages.push(m));
    host.send({ type: 'hello', protocolVersion: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    const snapshot = (
      messages.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot }
    ).snapshot;
    expect(snapshot.heroes.map((h) => [h.name, h.state.kind])).toEqual([
      ['Ranger Ilse', 'idle'],
      ['Rogue Vex', 'idle'],
    ]);
    expect(snapshot.islands.map((i) => i.worktree)).toEqual(['ready', 'ready']);
    // Its council isn't played as well: the sitting stays approved.
    expect(snapshot.sitting?.status).toBe('approved');
    host.send({ type: 'requestActions', heroId: snapshot.heroes[1]?.id ?? '' });
    host.send({
      type: 'requestPreview',
      name: 'ibitsa:test',
      args: '',
      heroId: snapshot.heroes[1]?.id ?? '',
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(messages.filter((m) => m.type === 'actions').at(-1)).toMatchObject({
      heroId: snapshot.heroes[1]?.id,
    });
    expect(messages.filter((m) => m.type === 'preview').at(-1)).toMatchObject({
      heroId: snapshot.heroes[1]?.id,
    });
    host.send({ type: 'hello', protocolVersion: 1 });
    await vi.advanceTimersByTimeAsync(10);
    const again = (messages.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot })
      .snapshot;
    expect(again.heroes).toHaveLength(2);
  });
});

describe('LiveDevHost: scripted reviews (#141)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A reviewed task from the dev shortcut, handed in once. */
  async function submitted(scenario: string) {
    const { host, snapshot, settle } = setup();
    host.scriptedReviews(scenario);
    await settle();
    const heroId = snapshot()?.heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'm', heroId, text: 'submit it', priority: 'now' });
    await settle();
    await settle();
    const task = () => snapshot()?.islands[0]?.taskPoints[0];
    return { host, snapshot, settle, task };
  }

  it('changes once, then a pass: the hero fixes it and the asking councillor passes round 2', async () => {
    const { snapshot, task } = await submitted('pass');
    expect(task()?.state).toBe('done');
    const review = task()?.review;
    expect(review?.phase).toBe('passed');
    expect(review?.checks?.map((c) => [c.command, c.ok])).toEqual([
      ['pnpm test', true],
      ['pnpm lint', true],
    ]);
    expect(review?.reviews.map((r) => [r.round, r.councillorId, r.verdict?.verdict])).toEqual([
      [1, 'tester', 'changes'],
      [1, 'security', 'pass'],
      [2, 'tester', 'pass'],
    ]);
    expect(review?.reviews[0]?.verdict?.findings[0]).toMatchObject({
      severity: 'blocking',
      criterion: 'Signing in lands on the page you asked for.',
      file: 'src/app.ts',
      line: 12,
    });
    expect(review?.suggestions).toEqual([
      expect.objectContaining({ councillorId: 'tester', severity: 'suggestion' }),
    ]);
    expect(snapshot()?.needsYou.map((i) => i.kind)).not.toContain('reviewEscalation');
  });

  it('stubborn: keeps asking until the loop limit of 2, then asks you; Accept anyway passes it', async () => {
    const { host, snapshot, settle, task } = await submitted('stubborn');
    expect(task()?.review?.phase).toBe('escalated');
    expect(task()?.review?.round).toBe(2);
    const item = snapshot()?.needsYou.find((i) => i.kind === 'reviewEscalation');
    expect(item).toMatchObject({ reason: 'loopLimit' });
    host.send({
      type: 'resolveReview',
      commandId: 'r',
      itemId: item?.id ?? '',
      decision: 'accept',
    });
    await settle();
    expect(task()?.state).toBe('done');
  });

  it('revisit: a suggestion asks to revisit D1, which goes to you and can be dismissed', async () => {
    const { host, snapshot, settle } = await submitted('revisit');
    const item = snapshot()?.needsYou.find((i) => i.kind === 'revisitDecision');
    expect(item).toMatchObject({ councillorId: 'tester', decisionId: 'D1' });
    host.send({ type: 'dismissItem', commandId: 'd', itemId: item?.id ?? '' });
    await settle();
    expect(snapshot()?.needsYou.some((i) => i.kind === 'revisitDecision')).toBe(false);
  });

  it('dispute: the hero disputes the findings; dropping them lets the task pass', async () => {
    const { host, snapshot, settle, task } = await submitted('dispute');
    const item = snapshot()?.needsYou.find((i) => i.kind === 'dispute');
    expect(item).toMatchObject({ reason: expect.stringContaining('D1') });
    expect(item?.kind === 'dispute' && item.findings.map((f) => f.councillorId)).toEqual([
      'tester',
    ]);
    host.send({ type: 'resolveDispute', commandId: 'x', itemId: item?.id ?? '', decision: 'drop' });
    await settle();
    await settle();
    expect(task()?.state).toBe('done');
    // Only the first round ran: the dropped findings needed no second look.
    expect(task()?.review?.reviews.every((r) => r.round === 1)).toBe(true);
  });

  it('failing: the tests fail once and the hero waits; handed in again, the second run passes', async () => {
    const { host, snapshot, settle, task } = await submitted('failing');
    expect(task()?.state).toBe('active');
    expect(task()?.review?.phase).toBe('changes');
    expect(task()?.review?.checks?.map((c) => c.ok)).toEqual([false, true]);
    expect(snapshot()?.heroes[0]?.state.kind).toBe('idle');
    const heroId = snapshot()?.heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'm2', heroId, text: 'submit it', priority: 'now' });
    await settle();
    await settle();
    expect(task()?.review?.checks?.every((c) => c.ok)).toBe(true);
    expect(task()?.state).toBe('done');
    expect(scriptedChecks(true)[0]).toMatchObject({
      ok: false,
      output: expect.stringContaining('FAIL'),
    });
  });

  it('broken: a reviewer that can not finish goes to you with its error', async () => {
    const { snapshot, task } = await submitted('broken');
    expect(snapshot()?.needsYou.find((i) => i.kind === 'reviewEscalation')).toMatchObject({
      reason: 'reviewFailed',
    });
    expect(task()?.review?.reviews.find((r) => r.status === 'failed')?.error).toBe(
      'The reviewer ran out of gold before finishing.',
    );
  });

  it('reviews=1 checks the demo campaign too, and keeps the other settings', async () => {
    const host = new LiveDevHost({
      credentialsReady: true,
      repo,
      reviews: true,
      campaignBudgetUsd: 2,
    });
    const messages: CoreMessage[] = [];
    host.onMessage((m) => messages.push(m));
    host.demoCampaign('separate');
    await vi.advanceTimersByTimeAsync(5_000);
    const snapshot = () =>
      (messages.filter((m) => m.type === 'snapshot').at(-1) as { snapshot: Snapshot }).snapshot;
    const heroId = snapshot().heroes[0]?.id ?? '';
    host.send({ type: 'sendMessage', commandId: 'm', heroId, text: 'submit it', priority: 'now' });
    await vi.advanceTimersByTimeAsync(5_000);
    // The demo plan has no criteria, so the checks are all its review.
    const task = snapshot().islands[0]?.taskPoints[0];
    expect(task?.review).toMatchObject({ phase: 'passed', reviews: [] });
    expect(task?.review?.checks).toHaveLength(2);
    expect(snapshot().campaign).toMatchObject({ capMicroUsd: 2_000_000, maxParallel: 2 });
  });

  it('a reviewer without criteria blocks on a bug, and nobody asks after round 1 unless stubborn', () => {
    const effect = {
      type: 'startReview' as const,
      reviewId: 'r9',
      taskPointId: 'tp',
      councillorId: 'architect',
      effort: 'light' as const,
      round: 1,
      worktreePath: '/w',
      from: 'main',
      to: 'head',
      since: null,
      task: { title: 'Plain', description: '' },
      criteria: [],
      decisions: [],
      checks: [],
    };
    const verdict = (events: ReturnType<typeof scriptedReview>) =>
      events.find((e) => e.type === 'verdictSubmitted');
    expect(verdict(scriptedReview({ effect, first: true }))).toMatchObject({
      toolUseId: 'v-r9',
      verdict: { verdict: 'changes', findings: [{ kind: 'bug' }, { severity: 'suggestion' }] },
    });
    expect(verdict(scriptedReview({ effect: { ...effect, round: 2 }, first: true }))).toMatchObject(
      { verdict: { verdict: 'pass', findings: [] } },
    );
    expect(verdict(scriptedReview({ effect, first: false }))).toMatchObject({
      verdict: { verdict: 'pass', findings: [] },
    });
  });
});
