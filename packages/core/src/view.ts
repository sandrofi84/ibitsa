import type {
  ExecutionState,
  HeroView,
  MicroUsd,
  NeedsYouItem,
  Reading,
  Snapshot,
} from '@ibitsa/protocol';
import type { CoreState, Hero } from './state';

/** One execution state per hero, highest precedence first (§5.4). */
export function deriveState(hero: Hero, state: CoreState): ExecutionState {
  if (hero.unknownReason !== null) return { kind: 'unknown', reason: hero.unknownReason };
  if (hero.error !== null) return { kind: 'error', message: hero.error };
  if (hero.outOfGold) return { kind: 'outOfGold' };
  const asking = state.needsYou.some(
    (i) => i.heroId === hero.id && (i.kind === 'permission' || i.kind === 'question'),
  );
  if (asking) return { kind: 'waitingOnYou' };
  if (hero.resting) return { kind: 'resting' };
  if (hero.inTurn || hero.runningTools.length > 0) return { kind: 'working' };
  if (hero.submitted) return { kind: 'submitted', summary: hero.submitted.summary };
  if (hero.sessionStarted) return { kind: 'idle' };
  return { kind: 'traveling' };
}

function heroView(hero: Hero, state: CoreState): HeroView {
  const execution = deriveState(hero, state);
  const tool = hero.runningTools.at(-1);
  const activity =
    execution.kind !== 'working'
      ? null
      : tool
        ? { kind: tool.kind, ...(tool.detail === undefined ? {} : { detail: tool.detail }) }
        : { kind: 'think' as const };
  return {
    id: hero.id,
    name: hero.name,
    classId: hero.classId,
    islandId: hero.islandId,
    taskPointId: hero.taskPointId,
    state: execution,
    activity,
    hp: hero.hp,
    gold: hero.gold,
    queuedMessages: hero.queuedMessages,
  };
}

/** Totals are computed here, never by front ends: one unknown makes the total unknown. */
export function sumGold(readings: Reading<MicroUsd>[]): Reading<MicroUsd> {
  let total = 0;
  const bases: string[] = [];
  for (const r of readings) {
    if (r.kind === 'unknown') return { kind: 'unknown' };
    total += r.value;
    if (r.kind === 'estimated') bases.push(r.basis);
  }
  return bases.length > 0
    ? { kind: 'estimated', value: total, basis: [...new Set(bases)].join('; ') }
    : { kind: 'exact', value: total };
}

export function view(state: CoreState): Snapshot {
  return {
    campaign: state.campaign && {
      ...state.campaign,
      gold: sumGold(state.heroes.map((h) => h.gold)),
    },
    islands: state.islands.map((i) => ({
      id: i.id,
      name: i.name,
      branch: i.branch,
      taskPoints: i.taskPoints.map(({ id, title, state }) => ({ id, title, state })),
    })),
    heroes: state.heroes.map((h) => heroView(h, state)),
    needsYou: state.needsYou.map((item): NeedsYouItem => {
      if (item.kind === 'reply') return { ...item };
      const { requestId: _requestId, ...visible } = item;
      return visible;
    }),
  };
}
