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
  campaign: { id: 'c1', title, status: 'active', gold: { kind: 'unknown' }, autoApprove: false },
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
