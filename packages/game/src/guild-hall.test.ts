import type { SettingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { parseRule, ruleText, ruleTitle } from './guild-hall';

const rule = (r: Partial<SettingView>): SettingView => ({
  key: 'review.loopLimit',
  description: '',
  kind: 'integer',
  nullable: false,
  value: 3,
  layer: 'default',
  defaultValue: 3,
  ...r,
});

describe('the Rule book (#179)', () => {
  it('names each rule in plain words', () => {
    expect(ruleTitle('review.loopLimit')).toBe('Review rounds before you decide');
    expect(ruleTitle('hero.budgetUsd')).toBe("A hero's gold pouch ($)");
  });

  it('shows a value as its input does: a list one per line, none as an empty field', () => {
    expect(ruleText(3)).toBe('3');
    expect(ruleText(['pnpm test', 'pnpm lint'])).toBe('pnpm test\npnpm lint');
    expect(ruleText(null)).toBe('');
  });

  it('reads what was typed as the rule wants it, or says why it cannot', () => {
    expect(parseRule({ rule: rule({}), text: ' 5 ' })).toEqual({ ok: true, value: 5 });
    expect(parseRule({ rule: rule({}), text: '2.5' })).toEqual({
      ok: false,
      reason: 'A whole number, please.',
    });
    expect(parseRule({ rule: rule({ minimum: 1 }), text: '0' })).toEqual({
      ok: false,
      reason: 'At least 1.',
    });
    expect(parseRule({ rule: rule({}), text: '' })).toEqual({
      ok: false,
      reason: 'This needs a value.',
    });
    const budget = rule({ key: 'hero.budgetUsd', kind: 'number', nullable: true });
    expect(parseRule({ rule: budget, text: '' })).toEqual({ ok: true, value: null });
    expect(parseRule({ rule: budget, text: '2.5' })).toEqual({ ok: true, value: 2.5 });
    expect(parseRule({ rule: budget, text: 'lots' })).toEqual({
      ok: false,
      reason: 'A number, please.',
    });
    const checks = rule({ key: 'checks', kind: 'list', nullable: true });
    expect(parseRule({ rule: checks, text: 'pnpm test\n\n pnpm lint ' })).toEqual({
      ok: true,
      value: ['pnpm test', 'pnpm lint'],
    });
    const mode = rule({ key: 'council.mode', kind: 'choice', choices: ['ask', 'chambers'] });
    expect(parseRule({ rule: mode, text: 'chambers' })).toEqual({ ok: true, value: 'chambers' });
    expect(parseRule({ rule: mode, text: 'party' })).toEqual({
      ok: false,
      reason: 'Choose one of the options.',
    });
    const setup = rule({ key: 'worktree.setup', kind: 'text' });
    expect(parseRule({ rule: setup, text: '' })).toEqual({ ok: true, value: '' });
  });
});
