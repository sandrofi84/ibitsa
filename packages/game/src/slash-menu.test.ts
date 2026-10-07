import type { ActionInfo, Command, CoreMessage, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { GameClient } from './client';
import type { Host } from './host.types';
import { actionItems, slashMenu } from './slash-menu';
import { MemoryViewStorage } from './view-state';

const action = (over: Partial<ActionInfo> & { name: string }): ActionInfo => ({
  description: '',
  argumentHint: '',
  aliases: [],
  source: 'project',
  target: 'any',
  ...over,
});

describe('actionItems (#84)', () => {
  const actions = [
    action({ name: 'pr', description: 'Open a PR', argumentHint: '[reviewers]' }),
    action({ name: 'mine', source: 'user' }),
    action({
      name: 'ibitsa:test',
      aliases: ['test'],
      source: 'plugin',
      target: 'hero',
      argumentHint: '[filter]',
    }),
    action({ name: 'other:deploy', source: 'plugin' }),
    action({ name: 'plan-council', target: 'council' }),
  ];

  it("puts Ibitsa's built-ins first under their short names, then by source", () => {
    expect(actionItems({ actions, query: '' })).toEqual([
      {
        id: 'action:ibitsa:test',
        label: '/test [filter]',
        detail: '',
        group: 'Ibitsa',
        insert: '/test',
      },
      {
        id: 'action:pr',
        label: '/pr [reviewers]',
        detail: 'Open a PR',
        group: 'Project',
        insert: '/pr',
      },
      { id: 'action:mine', label: '/mine', detail: '', group: 'Personal', insert: '/mine' },
      {
        id: 'action:other:deploy',
        label: '/other:deploy',
        detail: '',
        group: 'Plugins',
        insert: '/other:deploy',
      },
    ]);
  });

  it('matches names and aliases, and never offers council actions yet', () => {
    expect(actionItems({ actions, query: 'TE' }).map((i) => i.insert)).toEqual(['/test']);
    expect(actionItems({ actions, query: 'plan' })).toEqual([]);
  });
});

describe('slashMenu (#84)', () => {
  function client(status: 'active' | 'finished') {
    let deliver: (m: CoreMessage) => void = () => {};
    const sent: Command[] = [];
    const host: Host = {
      send: (c) => sent.push(c),
      onMessage: (l) => {
        deliver = l;
      },
      request: () => {},
      onHostEvent: () => {},
      viewStorage: new MemoryViewStorage(),
    };
    const c = new GameClient(host);
    const snapshot = {
      campaign: {
        id: 'c1',
        title: 'Q',
        status,
        gold: { kind: 'unknown' },
        autoApprove: false,
        branching: 'separate' as const,
        stackedStart: null,
        capMicroUsd: null,
        maxParallel: 2,
        shipped: false,
        ending: null,
      },
      elder: null,
      sitting: null,
      islands: [],
      heroes: [
        {
          id: 'h4',
          name: 'Ranger Ilse',
          classId: 'ranger',
          islandId: 'i2',
          taskPointId: 't3',
          state: { kind: 'idle' },
          activity: null,
          hp: { kind: 'unknown' },
          gold: { kind: 'unknown' },
          queuedMessages: 0,
        },
      ],
      needsYou: [],
    } as Snapshot;
    deliver({ type: 'snapshot', seq: 1, snapshot });
    // As the runtime answers: for the hero the menu asked about (#125), the only one here.
    const answer = () =>
      deliver({ type: 'actions', seq: 2, actions: [action({ name: 'pr' })], heroId: 'h4' });
    const opened: string[] = [];
    return {
      menu: slashMenu({ client: c }),
      withNew: slashMenu({ client: c, newAction: () => opened.push('form') }),
      opened,
      sent,
      answer,
    };
  }
  const query = (before: string) => ({ text: `${before}/`, token: '/', query: '', before });

  it('offers actions for the first word, or right after the recipient', async () => {
    const { menu, answer, sent } = client('active');
    const first = menu.suggest(query(''));
    answer();
    expect((await first).map((i) => i.insert)).toEqual(['/pr']);
    expect(sent).toEqual([{ type: 'requestActions', heroId: 'h4' }]);
    expect((await menu.suggest(query('@ranger-ilse '))).map((i) => i.insert)).toEqual(['/pr']);
  });

  it('offers nothing mid-message, or without a running quest', async () => {
    expect(await client('active').menu.suggest(query('please '))).toEqual([]);
    const ended = client('finished');
    expect(await ended.menu.suggest(query(''))).toEqual([]);
    expect(ended.sent).toEqual([]);
  });

  it('offers New action… last, which opens the form instead of inserting (#86)', async () => {
    const { withNew, opened, answer } = client('active');
    const pending = withNew.suggest(query(''));
    answer();
    const items = await pending;
    expect(items.at(-1)).toMatchObject({ id: 'new-action', label: 'New action…', insert: '' });
    items.at(-1)?.onChoose?.();
    expect(opened).toEqual(['form']);
  });
});
