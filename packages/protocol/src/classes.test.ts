import { describe, expect, it } from 'vitest';
import {
  classModelName,
  DEFAULT_CLASSES,
  modelName,
  resolveClasses,
  resolveRecolor,
} from './classes';

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
      agent: 'claude',
      model: 'sonnet',
      appearance: 'hero.rogue',
      names: ['Vex', 'Nim', 'Sable'],
      builtIn: true,
    });
    expect(classes.slice(4)).toEqual([
      {
        id: 'bard',
        name: 'Bard',
        agent: 'claude',
        model: 'claude-opus-5-5',
        appearance: 'hero.paladin',
        names: ['Lyra'],
        builtIn: false,
      },
      {
        id: 'monk',
        name: 'Monk',
        agent: 'claude',
        model: 'sonnet',
        appearance: 'hero.ranger',
        names: [],
        builtIn: false,
      },
    ]);
  });

  it("runs a class on its agent, without the old agent's model (#198)", () => {
    const classes = resolveClasses({
      seer: { agent: 'codex' },
      oracle: { agent: 'codex', model: 'gpt-6-luna' },
      ranger: { agent: 'gemini' },
      rogue: { name: 'Thief' },
    });
    const of = (id: string) => classes.find((c) => c.id === id);
    expect(of('seer')).toMatchObject({ agent: 'codex', model: '' });
    expect(of('oracle')).toMatchObject({ agent: 'codex', model: 'gpt-6-luna' });
    expect(of('ranger')).toMatchObject({ agent: 'gemini', model: '' });
    expect(of('rogue')).toMatchObject({ agent: 'claude', model: 'haiku' });
    expect(resolveClasses({ seer: { agent: 'Not An Id' } }).map((c) => c.id)).not.toContain('seer');
  });

  it('says what a class runs on in words', () => {
    expect(classModelName({ agent: 'claude', model: 'opus' })).toBe('Claude Opus');
    expect(classModelName({ agent: 'codex', model: 'gpt-6-luna' })).toBe('Codex · gpt-6-luna');
    expect(classModelName({ agent: 'mine', model: '' })).toBe('Mine · its default model');
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
