import type { CoreState } from '@ibitsa/core';
import { describe, expect, it } from 'vitest';
import { chooseHero } from './hero-choice';
import type { HeroOption } from './hero-choice.types';

type State = Pick<CoreState, 'campaign' | 'heroes' | 'islands'>;

const hero = (id: string, extra: Partial<CoreState['heroes'][number]> = {}) =>
  ({
    id,
    name: `Hero ${id}`,
    islandId: `i-${id}`,
    submitted: null,
    inTurn: false,
    ...extra,
  }) as CoreState['heroes'][number];
const island = (id: string, launched = true) =>
  ({ id: `i-${id}`, launched }) as CoreState['islands'][number];
const state = (heroes: CoreState['heroes'], islands: CoreState['islands']): State =>
  ({ campaign: { status: 'active' }, heroes, islands }) as State;

describe('chooseHero (#125)', () => {
  it('has no hero without a running quest', async () => {
    const never = async () => {
      throw new Error('should not ask');
    };
    expect(await chooseHero({ state: null, pick: never })).toBeNull();
    const finished = {
      ...state([hero('a')], [island('a')]),
      campaign: { status: 'finished' },
    } as State;
    expect(await chooseHero({ state: finished, pick: never })).toBeNull();
  });

  it('takes the only hero that has started without asking', async () => {
    const never = async () => {
      throw new Error('should not ask');
    };
    const one = state([hero('a'), hero('b')], [island('a'), island('b', false)]);
    expect(await chooseHero({ state: one, pick: never })).toEqual({ id: 'a', name: 'Hero a' });
  });

  it('asks which, offering each started hero with its state, and returns the one picked', async () => {
    const asked: HeroOption[][] = [];
    const both = state(
      [hero('a', { inTurn: true }), hero('b', { submitted: { summary: 'x' } }), hero('c')],
      [island('a'), island('b'), island('c')],
    );
    const picked = await chooseHero({
      state: both,
      pick: async (options) => {
        asked.push(options);
        return options[1];
      },
    });
    expect(asked[0]).toEqual([
      { id: 'a', label: 'Hero a', description: 'working' },
      { id: 'b', label: 'Hero b', description: 'submitted' },
      { id: 'c', label: 'Hero c', description: 'waiting for orders' },
    ]);
    expect(picked).toEqual({ id: 'b', name: 'Hero b' });
    expect(await chooseHero({ state: both, pick: async () => undefined })).toBeNull();
  });
});
