import { describe, expect, it } from 'vitest';
import { DEFAULT_CLASSES, modelName, resolveClasses, resolveRecolor } from './classes';

describe('resolveClasses (#182)', () => {
  it('is the four built-ins without settings', () => {
    expect(resolveClasses(undefined)).toEqual(DEFAULT_CLASSES);
    expect(resolveClasses({}).map((c) => `${c.id}:${c.model}`)).toEqual([
      'paladin:fable',
      'barbarian:opus',
      'ranger:sonnet',
      'rogue:haiku',
    ]);
  });

  it('remaps a built-in by id, keeping what the setting leaves out, and adds new classes', () => {
    const classes = resolveClasses({
      rogue: { model: 'sonnet' },
      bard: { name: 'Bard', model: 'claude-opus-5-5', appearance: 'hero.paladin', names: ['Lyra'] },
      monk: {},
    });
    expect(classes.find((c) => c.id === 'rogue')).toEqual({
      id: 'rogue',
      name: 'Rogue',
      model: 'sonnet',
      appearance: 'hero.rogue',
      names: ['Vex', 'Nim', 'Sable'],
      builtIn: true,
    });
    expect(classes.slice(4)).toEqual([
      {
        id: 'bard',
        name: 'Bard',
        model: 'claude-opus-5-5',
        appearance: 'hero.paladin',
        names: ['Lyra'],
        builtIn: false,
      },
      {
        id: 'monk',
        name: 'Monk',
        model: 'sonnet',
        appearance: 'hero.ranger',
        names: [],
        builtIn: false,
      },
    ]);
  });

  it('ignores a setting that does not check out', () => {
    expect(resolveClasses({ Bad: { model: 'x' } })).toEqual(DEFAULT_CLASSES);
    expect(resolveClasses('nonsense')).toEqual(DEFAULT_CLASSES);
  });

  it('says models in words', () => {
    expect(modelName('opus')).toBe('Claude Opus');
    expect(modelName('claude-opus-5-5')).toBe('claude-opus-5-5');
  });
});

describe('resolveRecolor (#182)', () => {
  it('keeps the entries that check out, with their defaults', () => {
    expect(
      resolveRecolor({
        'class:ranger': { hue: 120 },
        'councillor:security': { preset: 'gold' },
        'class:rogue': { hue: 999 },
        nonsense: { hue: 10 },
      }),
    ).toEqual({
      'class:ranger': { hue: 120, preset: 'none' },
      'councillor:security': { hue: 0, preset: 'gold' },
    });
    expect(resolveRecolor(null)).toEqual({});
  });
});
