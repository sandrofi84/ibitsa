import { DEFAULT_CLASSES, resolveClasses } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { appearances, newClassProblem } from './armory-tab';
import { defaultHeroName, heroClasses, setHeroClasses } from './heroes';
import { heroNameFor } from './parties';

afterEach(() => setHeroClasses(undefined));

describe('the Armory (#182)', () => {
  it('checks a new class id', () => {
    expect(newClassProblem({ id: 'bard', taken: ['ranger'] })).toBeNull();
    expect(newClassProblem({ id: 'Bard', taken: [] })).toBe('A lowercase word, e.g. bard.');
    expect(newClassProblem({ id: 'ranger', taken: ['ranger'] })).toBe(
      'That class exists already: edit it above.',
    );
  });

  it('offers the built-ins’ characters and any in use as appearances', () => {
    const view = {
      classes: [
        ...DEFAULT_CLASSES,
        { ...DEFAULT_CLASSES[0], id: 'bard', appearance: 'hero.bard' },
      ].map((c) => ({ ...c, id: c?.id ?? '', layer: 'default' as const })),
      recolor: [],
    } as Parameters<typeof appearances>[0];
    expect(appearances(view)).toEqual([
      'hero.paladin',
      'hero.barbarian',
      'hero.ranger',
      'hero.rogue',
      'hero.bard',
    ]);
  });

  it('lists the classes in play, in every form and default name', () => {
    expect(heroClasses().map((c) => `${c.id}:${c.model}`)).toEqual([
      'paladin:Claude Fable',
      'barbarian:Claude Opus',
      'ranger:Claude Sonnet',
      'rogue:Claude Haiku',
    ]);
    setHeroClasses(
      resolveClasses({ bard: { name: 'Bard', model: 'opus', names: ['Lyra'] }, monk: {} }),
    );
    expect(heroClasses().at(-2)).toEqual({
      id: 'bard',
      label: 'Bard',
      model: 'Claude Opus',
      names: ['Lyra'],
      appearance: 'hero.ranger',
    });
    expect(defaultHeroName('bard')).toBe('Bard Lyra');
    expect(defaultHeroName('monk')).toBe('Monk');
    expect(heroNameFor({ classId: 'bard', taken: ['Bard Lyra'] })).toBe('Bard Lyra 2');
    expect(heroNameFor({ classId: 'monk', taken: [] })).toBe('Monk');
    expect(heroNameFor({ classId: 'monk', taken: ['Monk'] })).toBe('Monk 2');
  });
});
