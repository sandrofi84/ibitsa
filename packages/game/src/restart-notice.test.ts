import type { Cue, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { resumedText } from './restart-notice';

const snapshot = {
  heroes: [
    { id: 'h1', name: 'Ranger Ilse' },
    { id: 'h2', name: 'Rogue Vex' },
    { id: 'h3', name: 'Paladin Aric' },
  ],
} as unknown as Snapshot;
const cue = (
  change: Partial<Extract<Cue, { type: 'resumed' }>>,
): Extract<Cue, { type: 'resumed' }> => ({
  type: 'resumed',
  heroIds: [],
  checks: 0,
  reviews: 0,
  council: false,
  elder: false,
  ...change,
});

describe('the restart notice (#166)', () => {
  it('names the heroes it resumed and counts what started over', () => {
    expect(resumedText({ cue: cue({ heroIds: ['h1', 'h2'], reviews: 1 }), snapshot })).toBe(
      'VS Code reloaded: resumed Ranger Ilse and Rogue Vex, restarted 1 review.',
    );
    expect(
      resumedText({ cue: cue({ heroIds: ['h1', 'h2', 'h3'], checks: 2, reviews: 3 }), snapshot }),
    ).toBe(
      'VS Code reloaded: resumed Ranger Ilse, Rogue Vex and Paladin Aric, ran 2 checks again, restarted 3 reviews.',
    );
  });

  it('says when the council or the elder picked up again, and copes without a snapshot', () => {
    expect(resumedText({ cue: cue({ council: true }), snapshot })).toBe(
      'VS Code reloaded: resumed the council.',
    );
    expect(
      resumedText({ cue: cue({ elder: true, checks: 1, heroIds: ['h9'] }), snapshot: null }),
    ).toBe("VS Code reloaded: resumed h9, restarted the elder's research, ran 1 check again.");
  });
});
