import type { CoreState } from '@ibitsa/core';
import type { HeroOption, HeroPicker } from './hero-choice.types';

/**
 * Which hero a Command Palette command is for (#125): with no hero on a running quest, none; with one,
 * that one; with several, the one picked. Only heroes whose island has started count (a blocked hero
 * waiting for a slot has no session to message or stop).
 */
export async function chooseHero({
  state,
  pick,
}: {
  state: Pick<CoreState, 'campaign' | 'heroes' | 'islands'> | null | undefined;
  pick: HeroPicker;
}): Promise<{ id: string; name: string } | null> {
  if (state?.campaign?.status !== 'active') return null;
  const started = state.heroes.filter(
    (h) => state.islands.find((i) => i.id === h.islandId)?.launched !== false,
  );
  if (started.length <= 1) {
    const only = started[0];
    return only ? { id: only.id, name: only.name } : null;
  }
  const options: HeroOption[] = started.map((h) => ({
    id: h.id,
    label: h.name,
    description: h.submitted ? 'submitted' : h.inTurn ? 'working' : 'waiting for orders',
  }));
  const chosen = await pick(options);
  const hero = started.find((h) => h.id === chosen?.id);
  return hero ? { id: hero.id, name: hero.name } : null;
}
