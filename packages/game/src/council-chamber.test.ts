import type { SittingView, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { chamberLines, chamberStatus, consultedSitting } from './council-chamber';

const sitting = (over: Partial<SittingView> = {}): SittingView =>
  ({
    status: 'approved',
    roster: [{ councillorId: 'security', effort: 'standard', reported: true }],
    dialogue: [],
    consultations: [],
    ...over,
  }) as unknown as SittingView;

describe('the council chamber (#169)', () => {
  it('is there only while the council can be asked', () => {
    const s = sitting();
    expect(
      consultedSitting({ campaign: { status: 'active' }, sitting: s } as unknown as Snapshot),
    ).toBe(s);
    expect(
      consultedSitting({
        campaign: { status: 'active' },
        sitting: sitting({ status: 'deliberating' }),
      } as unknown as Snapshot),
    ).toBeNull();
  });

  it('names who speaks in the latest lines', () => {
    const lines = Array.from({ length: 14 }, (_, i) => ({
      id: `d${i}`,
      speaker: i % 2 ? 'security' : 'you',
      text: `line ${i}`,
    }));
    const shown = chamberLines(sitting({ dialogue: lines }));
    expect(shown).toHaveLength(12);
    expect(shown.at(-1)).toEqual({
      id: 'd13',
      speaker: 'security',
      name: 'Security',
      text: 'line 13',
    });
    expect(shown.at(-2)).toMatchObject({ speaker: 'you', name: 'You' });
  });

  it('says when the council is thinking, or why it could not answer', () => {
    const asked = (status: 'asking' | 'answered' | 'failed', error: string | null = null) =>
      sitting({
        consultations: [{ id: 'q1', councillorId: null, status, error, gold: { kind: 'unknown' } }],
      });
    expect(chamberStatus(asked('asking'))).toBe('The council is thinking…');
    expect(chamberStatus(asked('failed', 'Out of gold'))).toBe(
      "The council couldn't answer: Out of gold",
    );
    expect(chamberStatus(asked('answered'))).toBeNull();
    expect(chamberStatus(sitting())).toBeNull();
  });
});
