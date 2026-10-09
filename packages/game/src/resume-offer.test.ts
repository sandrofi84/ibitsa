import { COUNCIL_RESUME, type HeroClassView, type HeroView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { idleText, resumeCost, resumeOfferOf } from './resume-offer';

const hero = (hp: HeroView['hp']) =>
  ({ id: 'h4', name: 'Ranger Ilse', classId: 'ranger', hp }) as HeroView;
const classes = [{ id: 'ranger', model: 'sonnet' }] as HeroClassView[];

describe('resumeCost (#293)', () => {
  it('prices a cold resume at the cache-write rate of the model family', () => {
    expect(resumeCost({ tokens: 100_000, model: 'sonnet' })).toBeCloseTo(0.25);
    expect(resumeCost({ tokens: 100_000, model: 'claude-opus-5-5' })).toBeCloseTo(0.5);
    expect(resumeCost({ tokens: 100_000, model: 'Haiku' })).toBeCloseTo(0.125);
  });

  it('gives no estimate for a model it does not know', () => {
    expect(resumeCost({ tokens: 100_000, model: '' })).toBeNull();
    expect(resumeCost({ tokens: 100_000, model: 'gpt-x' })).toBeNull();
  });
});

describe('idleText (#293)', () => {
  it('says how long in the largest whole unit', () => {
    expect(idleText(20_000)).toBe('1 min');
    expect(idleText(5 * 60_000)).toBe('5 min');
    expect(idleText(2 * 3_600_000)).toBe('2 h');
    expect(idleText(26 * 3_600_000)).toBe('1 day');
    expect(idleText(72 * 3_600_000)).toBe('3 days');
  });
});

describe('resumeOfferOf (#293)', () => {
  it('names each hero with its idle time, conversation size and estimated first turn', () => {
    const model = resumeOfferOf({
      offer: { heroes: [{ heroId: 'h4', idleMs: 2 * 3_600_000 }], council: null },
      heroes: [hero({ kind: 'exact', value: { used: 80_000, max: 200_000 } })],
      classes,
    });
    expect(model.items).toEqual([
      {
        id: 'h4',
        label: 'Ranger Ilse',
        detail: 'idle 2 h, 80k tokens of conversation, about $0.20 for its first turn back',
      },
    ]);
  });

  it('says the cost is unknown when the conversation size is, and offers the council', () => {
    const model = resumeOfferOf({
      offer: { heroes: [{ heroId: 'h4', idleMs: null }], council: { idleMs: 60_000 } },
      heroes: [hero({ kind: 'unknown' })],
      classes,
    });
    expect(model.items).toEqual([
      { id: 'h4', label: 'Ranger Ilse', detail: 'cost unknown' },
      {
        id: COUNCIL_RESUME,
        label: 'The council',
        detail: 'idle 1 min, its first turn back re-reads the whole sitting',
      },
    ]);
  });
});
