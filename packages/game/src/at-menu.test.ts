import type { Command, CoreMessage, ExecutionState, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { atMenu } from './at-menu';
import { GameClient } from './client';
import type { Host } from './host.types';
import { MemoryViewStorage } from './view-state';

class FakeHost implements Host {
  sent: Command[] = [];
  listener: (m: CoreMessage) => void = () => {};
  send(command: Command): void {
    this.sent.push(command);
    // Answer file requests at once, like a runtime with a small worktree.
    if (command.type === 'requestFiles') {
      queueMicrotask(() =>
        this.listener({
          type: 'files',
          seq: 9,
          islandId: command.islandId,
          paths: ['src/app.ts', 'src/auth/login.ts', 'README.md'],
        }),
      );
    }
  }
  onMessage(listener: (m: CoreMessage) => void): void {
    this.listener = listener;
  }
  readonly viewStorage = new MemoryViewStorage();
  request(): void {}
  onHostEvent(): void {}
}

function connected({
  status = 'active',
  worktree = 'ready',
}: {
  status?: 'active' | 'finished';
  worktree?: 'creating' | 'ready' | 'removed';
} = {}): GameClient {
  const client = new GameClient(new FakeHost());
  client.receive({
    type: 'snapshot',
    seq: 1,
    snapshot: {
      campaign: { id: 'c1', title: 'Q', status, gold: { kind: 'unknown' }, autoApprove: false },
      elder: null,
      sitting: null,
      islands: [{ id: 'i2', name: 'Q', branch: 'b', worktree, taskPoints: [] }],
      heroes: [
        {
          id: 'h4',
          name: 'Ranger Ilse',
          classId: 'ranger',
          islandId: 'i2',
          taskPointId: 't3',
          state: { kind: 'working' } as ExecutionState,
          activity: null,
          hp: { kind: 'unknown' },
          gold: { kind: 'unknown' },
          queuedMessages: 0,
        },
      ],
      needsYou: [],
    } as Snapshot,
  });
  return client;
}

const ask = (
  client: GameClient,
  {
    recipients = true,
    query = '',
    before = '',
  }: { recipients?: boolean; query?: string; before?: string } = {},
) =>
  Promise.resolve(
    atMenu({ client, recipients }).suggest({
      text: `${before}@${query}`,
      token: `@${query}`,
      query,
      before,
    }),
  );

describe('atMenu (#83)', () => {
  it('offers recipients, then files', async () => {
    const items = await ask(connected());
    expect(items.map((i) => [i.group, i.label])).toEqual([
      ['Recipients', '@ranger-ilse'],
      ['Recipients', '@all'],
      ['Files', 'README.md'],
      ['Files', 'src/app.ts'],
      ['Files', 'src/auth/login.ts'],
    ]);
    expect(items[0]).toMatchObject({ detail: 'Ranger Ilse · Working', insert: '@ranger-ilse' });
    expect(items[2]).toMatchObject({ insert: '@README.md' });
  });

  it('narrows both groups by what is typed', async () => {
    expect((await ask(connected(), { query: 'rang' })).map((i) => i.label)).toEqual([
      '@ranger-ilse',
    ]);
    expect((await ask(connected(), { query: 'login' })).map((i) => i.label)).toEqual([
      'src/auth/login.ts',
    ]);
  });

  it('offers no recipients once one is named, or in the hero pane', async () => {
    const named = await ask(connected(), { before: '@ranger-ilse look at ' });
    expect(named.every((i) => i.group === 'Files')).toBe(true);
    const pane = await ask(connected(), { recipients: false });
    expect(pane.every((i) => i.group === 'Files')).toBe(true);
  });

  it('offers nothing without a running quest, and no files before the worktree exists', async () => {
    expect(await ask(connected({ status: 'finished' }))).toEqual([]);
    const early = await ask(connected({ worktree: 'creating' }));
    expect(early.map((i) => i.group)).toEqual(['Recipients', 'Recipients']);
  });
});
