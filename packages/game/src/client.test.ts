import type { Command, CoreMessage, Cue, JournalEntry, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { GameClient } from './client';
import type { Host } from './host.types';
import { MemoryViewStorage } from './view-state';

class FakeHost implements Host {
  sent: Command[] = [];
  private listener: (m: CoreMessage) => void = () => {};
  send(command: Command): void {
    this.sent.push(command);
  }
  onMessage(listener: (m: CoreMessage) => void): void {
    this.listener = listener;
  }
  deliver(m: CoreMessage): void {
    this.listener(m);
  }
  readonly viewStorage = new MemoryViewStorage();
  request(): void {}
  onHostEvent(): void {}
}

const snap = (title: string): Snapshot => ({
  campaign: {
    id: 'c1',
    title,
    status: 'active',
    gold: { kind: 'unknown' },
    autoApprove: false,
    branching: 'separate' as const,
    stackedStart: null,
    capMicroUsd: null,
    maxParallel: 2,
  },
  elder: null,
  sitting: null,
  islands: [],
  heroes: [],
  needsYou: [],
});
const cue: Cue = { type: 'needsYouAdded', itemId: 'n5' };

describe('GameClient', () => {
  it('says hello with the protocol version', () => {
    const host = new FakeHost();
    new GameClient(host).start();
    expect(host.sent).toEqual([{ type: 'hello', protocolVersion: 1 }]);
  });

  it('keeps the newest snapshot and drops stale ones', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const seen: string[] = [];
    client.onSnapshot((s) => seen.push(s.campaign?.title ?? ''));
    host.deliver({ type: 'snapshot', seq: 2, snapshot: snap('new') });
    host.deliver({ type: 'snapshot', seq: 1, snapshot: snap('old') });
    expect(seen).toEqual(['new']);
    expect(client.snapshot?.campaign?.title).toBe('new');
  });

  it('drops cues older than the shown snapshot', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const cues: Cue[] = [];
    client.onCue((c) => cues.push(c));
    host.deliver({ type: 'snapshot', seq: 5, snapshot: snap('s') });
    host.deliver({ type: 'cue', seq: 4, cue });
    host.deliver({ type: 'cue', seq: 6, cue });
    expect(cues).toEqual([cue]);
  });

  it('ignores everything after a protocol version mismatch', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    host.deliver({ type: 'welcome', seq: 1, protocolVersion: 99 });
    host.deliver({ type: 'snapshot', seq: 2, snapshot: snap('s') });
    expect(client.versionMismatch).toBe(true);
    expect(client.snapshot).toBeNull();
  });

  it('adds a command id to every intent', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const id = client.send({ type: 'stopHero', heroId: 'h4' });
    expect(host.sent).toEqual([{ type: 'stopHero', heroId: 'h4', commandId: id }]);
  });
});

describe('GameClient journal (#58)', () => {
  const line = (text: string): JournalEntry => ({ t: 0, heroId: 'h4', kind: 'said', text });
  const texts = (client: GameClient) => client.journal.map((e) => ('text' in e ? e.text : ''));

  function connected() {
    const host = new FakeHost();
    const client = new GameClient(host);
    let changes = 0;
    client.onJournal(() => changes++);
    host.deliver({ type: 'welcome', seq: 1, protocolVersion: 1 });
    return { host, client, changes: () => changes };
  }

  it('asks for the latest page once welcomed', () => {
    const { host } = connected();
    expect(host.sent).toEqual([{ type: 'requestJournal' }]);
  });

  it('holds the latest page, adds earlier pages in front and live lines at the end', () => {
    const { host, client, changes } = connected();
    host.deliver({ type: 'journal', seq: 2, entries: [line('c'), line('d')], start: 2, total: 4 });
    expect(texts(client)).toEqual(['c', 'd']);
    expect(client.journalStart).toBe(2);

    client.loadEarlierJournal();
    expect(host.sent.at(-1)).toEqual({ type: 'requestJournal', before: 2 });
    host.deliver({ type: 'journal', seq: 3, entries: [line('a'), line('b')], start: 0, total: 4 });
    expect(texts(client)).toEqual(['a', 'b', 'c', 'd']);
    client.loadEarlierJournal();
    expect(host.sent.at(-1)).toEqual({ type: 'requestJournal', before: 2 });

    host.deliver({ type: 'journalAppend', seq: 4, entries: [line('e')], start: 4 });
    expect(texts(client)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(changes()).toBe(3);
  });

  it('starts over when a new campaign begins, and refetches after a gap', () => {
    const { host, client } = connected();
    host.deliver({ type: 'journal', seq: 2, entries: [line('old')], start: 0, total: 1 });
    host.deliver({ type: 'journalAppend', seq: 3, entries: [line('new')], start: 0 });
    expect(texts(client)).toEqual(['new']);

    host.sent.length = 0;
    host.deliver({ type: 'journalAppend', seq: 4, entries: [line('far')], start: 9 });
    expect(texts(client)).toEqual(['new']);
    expect(host.sent).toEqual([{ type: 'requestJournal' }]);
    // A page that is neither the latest nor right before what is held is ignored.
    host.deliver({ type: 'journal', seq: 5, entries: [line('x')], start: 3, total: 9 });
    expect(texts(client)).toEqual(['new']);
  });
});

describe('GameClient project rules (#62)', () => {
  it('forgets a rule with a runtime-only command, without a command id', () => {
    const host = new FakeHost();
    new GameClient(host).forgetProjectRule('Bash(npm test:*)');
    expect(host.sent).toEqual([{ type: 'forgetProjectRule', rule: 'Bash(npm test:*)' }]);
  });
});

describe('GameClient files (#83)', () => {
  it('asks once, shares the answer, and asks again once the list is old', async () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const first = client.files('i2');
    const second = client.files('i2');
    expect(host.sent).toEqual([{ type: 'requestFiles', islandId: 'i2' }]);
    host.deliver({ type: 'files', seq: 1, islandId: 'i2', paths: ['a.ts'] });
    expect(await first).toEqual(['a.ts']);
    expect(await second).toEqual(['a.ts']);

    const realNow = Date.now;
    Date.now = () => realNow() + GameClient.FILES_TTL_MS + 1;
    try {
      void client.files('i2');
      expect(host.sent).toHaveLength(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('ignores an answer nobody asked for', () => {
    const host = new FakeHost();
    new GameClient(host).receive({ type: 'files', seq: 1, islandId: 'x', paths: [] });
    expect(host.sent).toEqual([]);
  });
});

describe('GameClient actions (#84)', () => {
  it('asks for the / menu and keeps what the runtime sends', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const seen: string[][] = [];
    client.onActions((a) => seen.push(a.map((x) => x.name)));
    client.requestActions();
    expect(host.sent).toEqual([{ type: 'requestActions' }]);
    host.deliver({
      type: 'actions',
      seq: 1,
      actions: [
        {
          name: 'ibitsa:test',
          description: '',
          argumentHint: '',
          aliases: ['test'],
          source: 'plugin',
          target: 'hero',
        },
      ],
    });
    expect(client.actions.map((a) => a.name)).toEqual(['ibitsa:test']);
    expect(seen).toEqual([['ibitsa:test']]);
  });
});

describe('GameClient actionsReady (#84)', () => {
  const list = (name: string) => [
    {
      name,
      description: '',
      argumentHint: '',
      aliases: [],
      source: 'project' as const,
      target: 'any' as const,
    },
  ];
  const quest = (id: string): Snapshot => ({
    campaign: {
      id,
      title: 'Q',
      status: 'active',
      gold: { kind: 'unknown' },
      autoApprove: false,
      branching: 'separate' as const,
      stackedStart: null,
      capMicroUsd: null,
      maxParallel: 2,
    },
    elder: null,
    sitting: null,
    islands: [],
    heroes: [],
    needsYou: [],
  });

  it('asks once per quest and resolves with what the runtime sends', async () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    host.deliver({ type: 'snapshot', seq: 1, snapshot: quest('c1') });
    const first = client.actionsReady();
    const again = client.actionsReady();
    expect(host.sent).toEqual([{ type: 'requestActions' }]);
    host.deliver({ type: 'actions', seq: 2, actions: list('a') });
    expect((await first).map((a) => a.name)).toEqual(['a']);
    expect((await again).map((a) => a.name)).toEqual(['a']);
    expect((await client.actionsReady()).map((a) => a.name)).toEqual(['a']);
    expect(host.sent).toHaveLength(1);

    // A pushed update replaces the list; a new quest asks again.
    host.deliver({ type: 'actions', seq: 3, actions: list('b') });
    expect((await client.actionsReady()).map((a) => a.name)).toEqual(['b']);
    host.deliver({ type: 'snapshot', seq: 4, snapshot: quest('c2') });
    void client.actionsReady();
    expect(host.sent).toHaveLength(2);
  });

  it("keeps each hero's list apart, and drops them all when a skill changes (#125)", async () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    host.deliver({ type: 'snapshot', seq: 1, snapshot: quest('c1') });
    const forTwo = client.actionsReady('h2');
    expect(host.sent).toEqual([{ type: 'requestActions', heroId: 'h2' }]);
    host.deliver({ type: 'actions', seq: 2, actions: list('two'), heroId: 'h2' });
    expect((await forTwo).map((a) => a.name)).toEqual(['two']);
    const forOne = client.actionsReady('h1');
    host.deliver({ type: 'actions', seq: 3, actions: list('one'), heroId: 'h1' });
    expect((await forOne).map((a) => a.name)).toEqual(['one']);
    expect((await client.actionsReady('h2')).map((a) => a.name)).toEqual(['two']);
    expect(host.sent).toHaveLength(2);
    // A push (no hero): every held list is stale.
    host.deliver({ type: 'actions', seq: 4, actions: list('new') });
    void client.actionsReady('h2');
    expect(host.sent.at(-1)).toEqual({ type: 'requestActions', heroId: 'h2' });
  });
});

describe('GameClient preview (#85)', () => {
  it('asks once for the same action and arguments, and answers each waiter', async () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const a = client.preview({ name: 'pr', args: 'x' });
    const b = client.preview({ name: 'pr', args: 'x' });
    const other = client.preview({ name: 'pr', args: 'y' });
    expect(host.sent).toEqual([
      { type: 'requestPreview', name: 'pr', args: 'x' },
      { type: 'requestPreview', name: 'pr', args: 'y' },
    ]);
    host.deliver({
      type: 'preview',
      seq: 1,
      preview: { name: 'pr', args: 'x', text: 'X', notes: [] },
    });
    host.deliver({
      type: 'preview',
      seq: 2,
      preview: { name: 'pr', args: 'y', text: null, notes: [] },
    });
    expect((await a).text).toBe('X');
    expect((await b).text).toBe('X');
    expect((await other).text).toBeNull();
    // An answer nobody waits for is ignored.
    host.deliver({
      type: 'preview',
      seq: 3,
      preview: { name: 'z', args: '', text: 'Z', notes: [] },
    });
  });

  it("asks per hero, and answers each hero's waiters with its own preview (#125)", async () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const one = client.preview({ name: 'pr', args: '', heroId: 'h1' });
    const two = client.preview({ name: 'pr', args: '', heroId: 'h2' });
    expect(host.sent).toEqual([
      { type: 'requestPreview', name: 'pr', args: '', heroId: 'h1' },
      { type: 'requestPreview', name: 'pr', args: '', heroId: 'h2' },
    ]);
    host.deliver({
      type: 'preview',
      seq: 1,
      preview: { name: 'pr', args: '', text: 'TWO', notes: [] },
      heroId: 'h2',
    });
    host.deliver({
      type: 'preview',
      seq: 2,
      preview: { name: 'pr', args: '', text: 'ONE', notes: [] },
      heroId: 'h1',
    });
    expect((await one).text).toBe('ONE');
    expect((await two).text).toBe('TWO');
  });
});

describe('GameClient new actions (#86)', () => {
  it('sends a draft, and reports how it went', () => {
    const host = new FakeHost();
    const client = new GameClient(host);
    const results: unknown[] = [];
    client.onActionResult((r) => results.push(r));
    const draft = {
      name: 'pr',
      description: 'd',
      argumentHint: '',
      prompt: 'p',
      target: 'hero' as const,
      scope: 'personal' as const,
    };
    client.createAction({ draft, overwrite: false });
    client.createAction({ draft, overwrite: true });
    expect(host.sent).toEqual([
      { type: 'createAction', ...draft },
      { type: 'createAction', ...draft, overwrite: true },
    ]);
    host.deliver({ type: 'actionCreated', seq: 1, name: 'pr' });
    host.deliver({ type: 'actionRejected', seq: 2, name: 'pr', reason: 'taken', clash: true });
    expect(results).toEqual([
      { ok: true, name: 'pr' },
      { ok: false, name: 'pr', reason: 'taken', clash: true },
    ]);
  });
});
