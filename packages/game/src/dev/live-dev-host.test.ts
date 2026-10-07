import type { CoreMessage, Snapshot } from '@ibitsa/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDevHost } from './live-dev-host';

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
