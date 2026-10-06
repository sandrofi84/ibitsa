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
