import type { NeedsYouItem, Snapshot } from '@ibitsa/protocol';
import { Elder } from './elder';
import { Hero } from './hero';
import { NeedsYou } from './needs-you';
import { Outbox } from './outbox';
import { Quest } from './quest';
import { Sitting } from './sitting';
import type { CoreState } from './state.types';

/** The snapshot front ends see (spec §11.2.1). Read-only: anything a domain class emits here is discarded. */
export function view(state: CoreState): Snapshot {
  const outbox = new Outbox();
  const ctx = { state, outbox, needsYou: new NeedsYou({ state, outbox }), t: 0 };
  return {
    campaign: state.campaign && {
      ...state.campaign,
      gold: Quest.totalGold([
        ...(state.elder && state.elder.gold.kind !== 'unknown' ? [state.elder] : []),
        ...state.heroes,
      ]),
    },
    elder: state.elder && Elder.view(state.elder),
    sitting: state.sitting && Sitting.view(state.sitting),
    islands: state.islands.map((i) => ({
      id: i.id,
      name: i.name,
      branch: i.branch,
      worktree: i.worktreeRemoved ? 'removed' : i.worktreePath ? 'ready' : 'creating',
      taskPoints: i.taskPoints.map(({ id, title, state }) => ({ id, title, state })),
    })),
    heroes: state.heroes.map((record) => new Hero({ record, ctx }).view()),
    needsYou: state.needsYou.map((item): NeedsYouItem => {
      if (item.kind !== 'permission' && item.kind !== 'question') return { ...item };
      const { requestId: _requestId, ...visible } = item;
      return visible;
    }),
  };
}
