import { DEFAULT_CLASSES, type HeroClassView } from '@ibitsa/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultHeroName,
  SPEECH_MAX,
  sandboxNote,
  setHeroClasses,
  speechExcerpt,
  UNSANDBOXED_NOTE,
} from './heroes';

describe('defaultHeroName', () => {
  it('names the class and its first default, or falls back', () => {
    expect(defaultHeroName('rogue')).toBe('Rogue Vex');
    expect(defaultHeroName('bard')).toBe('Hero');
  });
});

describe('speechExcerpt', () => {
  it('keeps a short first sentence as it is', () => {
    expect(speechExcerpt('Done! The tests pass now.')).toBe('Done!');
    expect(speechExcerpt('All set')).toBe('All set');
  });

  it('drops Markdown marks, code blocks and line breaks', () => {
    expect(speechExcerpt('`slugify` is **fixed**.\n\nDetails follow.')).toBe('slugify is fixed.');
    expect(speechExcerpt('Look:\n```ts\nconst a = 1;\n```\nok')).toBe('Look: ok');
  });

  it('cuts a long sentence with an ellipsis', () => {
    const excerpt = speechExcerpt(
      'I fixed slugify so it strips accents and added a test for underscores.',
    );
    expect(excerpt.length).toBe(SPEECH_MAX);
    expect(excerpt.endsWith('…')).toBe(true);
  });

  it('does not end a sentence inside a file name or version', () => {
    expect(speechExcerpt('Edited slug.mjs today. Then more.')).toBe('Edited slug.mjs today.');
  });
});

describe('sandboxNote (#200)', () => {
  afterEach(() => setHeroClasses(undefined));

  it("speaks only for a class whose agent runs without Ibitsa's sandbox", () => {
    const added = (id: string, agent: string): HeroClassView => ({
      id,
      name: id,
      agent,
      model: '',
      appearance: 'hero.ranger',
      names: [],
      builtIn: false,
    });
    const seer = added('seer', 'opencode');
    const oracle = added('oracle', 'codex');
    setHeroClasses([...DEFAULT_CLASSES, { ...seer, sandboxed: false }, oracle]);
    expect(sandboxNote('seer')).toBe(UNSANDBOXED_NOTE);
    expect(sandboxNote('oracle')).toBeNull();
    expect(sandboxNote('ranger')).toBeNull();
    expect(sandboxNote('bard')).toBeNull();
    expect(UNSANDBOXED_NOTE).toContain('WSL or a dev container');
  });
});
