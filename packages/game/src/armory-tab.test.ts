import { DEFAULT_CLASSES, resolveClasses } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { agentChoice, appearances, newClassProblem } from './armory-tab';
import { defaultHeroName, heroClasses, setHeroClasses } from './heroes';
import { heroNameFor } from './parties';

afterEach(() => setHeroClasses(undefined));

describe("the Armory's agents (#198)", () => {
  const view = {
    classes: [],
    recolor: [],
    agents: [
      { id: 'codex', name: 'Codex', command: 'codex-acp', args: [], preset: true, found: true },
      {
        id: 'gemini',
        name: 'Gemini CLI',
        command: 'gemini',
        args: ['--acp'],
        preset: true,
        found: false,
      },
      {
        id: 'cc',
        name: 'Cc',
        command: 'claude-agent-acp',
        args: [],
        preset: false,
        found: true,
        refused: "Claude runs only through Ibitsa's own Claude adapter, not over ACP.",
      },
    ],
  };

  it('offers Claude and the installed agents as they are', () => {
    expect(agentChoice({ view, id: 'claude' })).toEqual({
      label: 'Claude',
      disabled: false,
      warning: null,
    });
    expect(agentChoice({ view, id: 'codex' })).toEqual({
      label: 'Codex',
      disabled: false,
      warning: null,
    });
  });

  it("says when an agent isn't installed, is refused, or isn't there at all", () => {
    expect(agentChoice({ view, id: 'gemini' })).toEqual({
      label: 'Gemini CLI (not installed)',
      disabled: false,
      warning:
        "Gemini CLI isn't installed: `gemini` isn't on your PATH. Ibitsa installs no agent; install it and sign in yourself.",
    });
    expect(agentChoice({ view, id: 'cc' })).toEqual({
      label: 'Cc (refused)',
      disabled: true,
      warning: "Claude runs only through Ibitsa's own Claude adapter, not over ACP.",
    });
    expect(agentChoice({ view, id: 'nowhere' })).toEqual({
      label: 'nowhere (unknown)',
      disabled: true,
      warning: 'There\'s no agent "nowhere" in ibitsa.agents: heroes of this class can\'t start.',
    });
  });

  it('lists an ACP class with its agent and model in words', () => {
    setHeroClasses(resolveClasses({ seer: { name: 'Seer', agent: 'codex' } }));
    expect(heroClasses().at(-1)?.model).toBe('Codex · its default model');
  });
});

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
      agents: [],
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
