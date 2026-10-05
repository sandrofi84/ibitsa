import type { Command, CoreMessage, Cue, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { GameClient } from './client';
import type { Host } from './host.types';

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
}

const snap = (title: string): Snapshot => ({
  campaign: { id: 'c1', title, status: 'active', gold: { kind: 'unknown' } },
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
