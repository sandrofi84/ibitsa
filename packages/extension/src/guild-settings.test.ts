import { describe, expect, it } from 'vitest';
import { GuildSettings } from './guild-settings';
import type { SettingLayers } from './guild-settings.types';

const schema = {
  'ibitsa.review.loopLimit': {
    type: 'integer',
    default: 3,
    minimum: 1,
    markdownDescription: 'Review rounds before `escalating`.',
  },
  'ibitsa.checks': { type: ['array', 'null'], default: null, description: 'Check commands.' },
  'ibitsa.hero.budgetUsd': { type: ['number', 'null'], default: null },
  'ibitsa.council.mode': {
    type: 'string',
    enum: ['ask', 'roundTable', 'chambers'],
    default: 'ask',
  },
  'ibitsa.worktree.setup': { type: 'string', default: '' },
};

function settings(layers: Record<string, SettingLayers> = {}) {
  return new GuildSettings({
    schema,
    inspect: (key) =>
      layers[key] ?? { defaultValue: schema[`ibitsa.${key}` as keyof typeof schema]?.default },
    update: async () => {},
  });
}

describe('GuildSettings (#179)', () => {
  it('lists every rule of the Rule book, in order, with how it is edited', () => {
    const rules = settings().rules();
    expect(rules.map((r) => r.key)).toEqual([
      'review.loopLimit',
      'checks',
      'parties.maxParallel',
      'hero.budgetUsd',
      'campaign.budgetUsd',
      'elder.model',
      'elder.budgetUsd',
      'council.mode',
      'council.consultBudgetUsd',
      'council.sittingBudgetUsd',
      'council.reviewBudgetUsd',
      'council.lessonsBudgetUsd',
      'pullRequests.pollSeconds',
      'worktree.setup',
      // Then the volumes (#184), for the Packs tab.
      'sound.master',
      'sound.alerts',
      'sound.voices',
      'sound.effects',
      'sound.music',
      'sound.focus',
    ]);
    expect(rules[0]).toEqual({
      key: 'review.loopLimit',
      description: 'Review rounds before escalating.',
      kind: 'integer',
      nullable: false,
      minimum: 1,
      value: 3,
      layer: 'default',
      defaultValue: 3,
    });
    expect(rules.find((r) => r.key === 'checks')).toMatchObject({ kind: 'list', nullable: true });
    expect(rules.find((r) => r.key === 'hero.budgetUsd')).toMatchObject({
      kind: 'number',
      nullable: true,
    });
    expect(rules.find((r) => r.key === 'council.mode')).toMatchObject({
      kind: 'choice',
      choices: ['ask', 'roundTable', 'chambers'],
    });
    expect(rules.find((r) => r.key === 'worktree.setup')).toMatchObject({ kind: 'text' });
    // A rule the manifest doesn't describe still shows, as text with no value.
    expect(rules.find((r) => r.key === 'parties.maxParallel')).toMatchObject({
      kind: 'text',
      value: null,
    });
  });

  it('says which layer wins: the project over you over the default', () => {
    const rules = settings({
      'review.loopLimit': { defaultValue: 3, globalValue: 4, workspaceValue: 5 },
      'hero.budgetUsd': { defaultValue: null, globalValue: 2.5 },
      checks: { defaultValue: null, workspaceValue: ['pnpm test', { not: 'a string' }] },
    }).rules();
    expect(rules.find((r) => r.key === 'review.loopLimit')).toMatchObject({
      value: 5,
      layer: 'workspace',
      user: 4,
      workspace: 5,
    });
    expect(rules.find((r) => r.key === 'hero.budgetUsd')).toMatchObject({
      value: 2.5,
      layer: 'user',
    });
    // What the Rule book can't show comes through as none.
    expect(rules.find((r) => r.key === 'checks')).toMatchObject({
      value: null,
      layer: 'workspace',
    });
  });
});
