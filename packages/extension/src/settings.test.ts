import { describe, expect, it } from 'vitest';
import {
  readCouncilMode,
  readDisabledCouncillors,
  readElderSettings,
  readUserSettings,
} from './settings';

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

describe('readDisabledCouncillors (#98)', () => {
  it('reads the ids, ignoring anything that is not one', () => {
    expect(
      readDisabledCouncillors(config({ 'council.disabled': ['designer', 3, 'tester'] })),
    ).toEqual(['designer', 'tester']);
    expect(readDisabledCouncillors(config({ 'council.disabled': 'designer' }))).toEqual([]);
    expect(readDisabledCouncillors(config({}))).toEqual([]);
  });
});

describe('readElderSettings (#101)', () => {
  it('reads the model and the cap in micro-dollars', () => {
    expect(readElderSettings(config({ 'elder.model': 'sonnet', 'elder.budgetUsd': 0.5 }))).toEqual({
      model: 'sonnet',
      budgetMicroUsd: 500_000,
    });
  });

  it('falls back to Haiku and $0.25 for anything else', () => {
    for (const values of [
      {},
      { 'elder.model': 'gpt', 'elder.budgetUsd': 0 },
      { 'elder.budgetUsd': '1' },
    ]) {
      expect(readElderSettings(config(values))).toEqual({
        model: 'haiku',
        budgetMicroUsd: 250_000,
      });
    }
  });
});

describe('readCouncilMode (#103)', () => {
  it('reads the mode, asking by default', () => {
    expect(readCouncilMode(config({ 'council.mode': 'roundTable' }))).toBe('roundTable');
    expect(readCouncilMode(config({ 'council.mode': 'chambers' }))).toBe('chambers');
    expect(readCouncilMode(config({ 'council.mode': 'sideways' }))).toBe('ask');
    expect(readCouncilMode(config({}))).toBe('ask');
  });
});
