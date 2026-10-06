import { describe, expect, it } from 'vitest';
import { defaultHeroName, SPEECH_MAX, speechExcerpt } from './heroes';

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
