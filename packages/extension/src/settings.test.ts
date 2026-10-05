import { describe, expect, it } from 'vitest';
import { readUserSettings } from './settings';

const config = (values: Record<string, unknown>) => ({
  get: <T>(key: string) => values[key] as T | undefined,
});

describe('readUserSettings', () => {
  it('converts the dollar budget to micro-dollars', () => {
    expect(readUserSettings(config({ 'hero.budgetUsd': 2.5 })).budgetMicroUsd).toBe(2_500_000);
  });

  it('treats an empty or non-positive budget as no cap', () => {
    for (const value of [null, undefined, 0, -1]) {
      expect(readUserSettings(config({ 'hero.budgetUsd': value })).budgetMicroUsd).toBeNull();
    }
  });

  it('uses the default stall thresholds', () => {
    expect(readUserSettings(config({})).stall).toEqual({
      testFailures: 4,
      fileEdits: 12,
      noProgressTurns: 6,
    });
  });
});
