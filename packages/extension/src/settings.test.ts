import { describe, expect, it } from 'vitest';
import {
  readChecks,
  readCouncillorOverrides,
  readCouncilMode,
  readDisabledCouncillors,
  readElderSettings,
  readPollSeconds,
  readResumeMode,
  readSessionCaps,
  readUserSettings,
} from './settings';

const config = (values: Record<string, unknown>) => ({
  get: <T>(key: string) => values[key] as T | undefined,
});

describe('readCouncillorOverrides (#181)', () => {
  it('keeps text fields and a list of tools for each councillor, dropping the rest', () => {
    expect(
      readCouncillorOverrides(
        config({
          councillors: {
            security: {
              title: ' Guardian ',
              model: '',
              tools: ['Read', 3],
              agent: ' codex ',
              extra: 'x',
            },
            tester: 'not an object',
          },
        }),
      ),
    ).toEqual({ security: { title: 'Guardian', tools: ['Read'], agent: 'codex' } });
    expect(readCouncillorOverrides(config({ councillors: ['nope'] }))).toEqual({});
    expect(readCouncillorOverrides(config({}))).toEqual({});
  });
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

  it('falls back to Haiku and no cap for anything else (#272)', () => {
    for (const values of [
      {},
      { 'elder.model': 'gpt', 'elder.budgetUsd': 0 },
      { 'elder.budgetUsd': '1' },
      { 'elder.budgetUsd': null },
    ]) {
      expect(readElderSettings(config(values))).toEqual({
        model: 'haiku',
        budgetMicroUsd: null,
      });
    }
  });
});

describe('readResumeMode (#293)', () => {
  it('reads the setting, and asks when it is missing or unknown', () => {
    const config = (value: unknown) => ({ get: <T>() => value as T });
    expect(readResumeMode(config('never'))).toBe('never');
    expect(readResumeMode(config('always'))).toBe('always');
    expect(readResumeMode(config(undefined))).toBe('ask');
    expect(readResumeMode(config('sometimes'))).toBe('ask');
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

describe('review settings (#139)', () => {
  it('reads the loop limit, 3 unless set to a whole number of at least one', () => {
    expect(readUserSettings(config({ 'review.loopLimit': 5 })).loopLimit).toBe(5);
    expect(readUserSettings(config({ 'review.loopLimit': 2.7 })).loopLimit).toBe(2);
    for (const value of [undefined, 0, -1, '4']) {
      expect(readUserSettings(config({ 'review.loopLimit': value })).loopLimit).toBe(3);
    }
  });

  it('reads the checks: the commands, an empty list for none, or null to detect them', () => {
    expect(readChecks(config({ checks: [' pnpm test ', 'pnpm lint', '', 3] }))).toEqual([
      'pnpm test',
      'pnpm lint',
    ]);
    expect(readChecks(config({ checks: [] }))).toEqual([]);
    expect(readChecks(config({}))).toBeNull();
    expect(readChecks(config({ checks: 'pnpm test' }))).toBeNull();
  });
});

describe('readPollSeconds (#152)', () => {
  it('is 60 by default, whole seconds, and never under 15', () => {
    expect(readPollSeconds(config({}))).toBe(60);
    expect(readPollSeconds(config({ 'pullRequests.pollSeconds': 90.5 }))).toBe(90);
    expect(readPollSeconds(config({ 'pullRequests.pollSeconds': 5 }))).toBe(60);
  });
});

describe('council.consultBudgetUsd (#169)', () => {
  it('is no cap by default, else the cap in micro-dollars (#272)', () => {
    expect(readUserSettings(config({})).consultBudgetMicroUsd).toBeNull();
    expect(
      readUserSettings(config({ 'council.consultBudgetUsd': 1.25 })).consultBudgetMicroUsd,
    ).toBe(1_250_000);
    expect(
      readUserSettings(config({ 'council.consultBudgetUsd': 0 })).consultBudgetMicroUsd,
    ).toBeNull();
  });
});

describe('readSessionCaps (#272)', () => {
  it('caps nothing by default', () => {
    expect(readSessionCaps(config({}))).toEqual({
      sittingMicroUsd: null,
      reviewMicroUsd: null,
      lessonsMicroUsd: null,
    });
  });

  it('reads each cap the user set, in micro-dollars', () => {
    expect(
      readSessionCaps(
        config({
          'council.sittingBudgetUsd': 3,
          'council.reviewBudgetUsd': 0.4,
          'council.lessonsBudgetUsd': 0.05,
        }),
      ),
    ).toEqual({ sittingMicroUsd: 3_000_000, reviewMicroUsd: 400_000, lessonsMicroUsd: 50_000 });
  });
});
