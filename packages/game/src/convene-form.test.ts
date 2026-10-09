import type { ResearchBrief } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { keptCouncilChoice } from './convene-form';

describe('keptCouncilChoice (#168)', () => {
  const brief = (keptContext: ResearchBrief['keptContext']) => ({ keptContext }) as ResearchBrief;

  it('offers nothing without a kept council', () => {
    expect(keptCouncilChoice({ kept: null, brief: brief(null) })).toBeNull();
  });

  it('ticks Start fresh when the elder found the task unrelated, and resumes otherwise', () => {
    const kept = { from: 'Sign-in' };
    expect(
      keptCouncilChoice({ kept, brief: brief({ related: false, reason: 'Different area.' }) }),
    ).toEqual({ from: 'Sign-in', fresh: true, note: 'The elder: Different area.' });
    expect(
      keptCouncilChoice({ kept, brief: brief({ related: true, reason: 'Same module.' }) }),
    ).toEqual({ from: 'Sign-in', fresh: false, note: 'The elder: Same module.' });
    expect(keptCouncilChoice({ kept, brief: null })).toEqual({
      from: 'Sign-in',
      fresh: false,
      note: null,
    });
  });
});
