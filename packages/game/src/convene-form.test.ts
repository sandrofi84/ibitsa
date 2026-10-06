import { describe, expect, it } from 'vitest';
import { estimatedCap } from './convene-form';

describe('estimatedCap (#105)', () => {
  it("is a round table's cap by its effort", () => {
    expect(estimatedCap({ mode: 'roundTable', effort: 'light', chambers: ['deep'] })).toBe(0.5);
    expect(estimatedCap({ mode: 'roundTable', effort: 'deep', chambers: [] })).toBe(6);
  });

  it("is every chamber's share plus the elder's reserve in separate chambers", () => {
    expect(
      estimatedCap({ mode: 'chambers', effort: 'deep', chambers: ['light', 'standard', 'deep'] }),
    ).toBeCloseTo(2);
    expect(estimatedCap({ mode: 'chambers', effort: 'light', chambers: [] })).toBeCloseTo(0.3);
  });
});
