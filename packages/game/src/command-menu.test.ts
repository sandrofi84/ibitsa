import { describe, expect, it } from 'vitest';
import { activeToken, applyChoice } from './command-menu';

const triggers = ['@', '/'];

describe('activeToken (#83)', () => {
  it('finds a trigger token at the start or after whitespace', () => {
    expect(activeToken({ text: '@ran', caret: 4, triggers })).toEqual({
      trigger: '@',
      start: 0,
      token: '@ran',
      query: 'ran',
    });
    expect(activeToken({ text: 'look at @src/a and', caret: 14, triggers })).toEqual({
      trigger: '@',
      start: 8,
      token: '@src/a',
      query: 'src/a',
    });
    expect(activeToken({ text: 'line\n/te', caret: 8, triggers })?.trigger).toBe('/');
  });

  it('ignores triggers inside a word, other words, and an empty token', () => {
    expect(activeToken({ text: 'mail ada@x', caret: 10, triggers })).toBeNull();
    expect(activeToken({ text: 'hello', caret: 5, triggers })).toBeNull();
    expect(activeToken({ text: 'a ', caret: 2, triggers })).toBeNull();
  });
});

describe('applyChoice (#83)', () => {
  it('replaces the token and adds one space, keeping what follows', () => {
    const token = { trigger: '@', start: 8, token: '@src/a', query: 'src/a' };
    expect(
      applyChoice({ text: 'look at @src/a and more', caret: 14, token, insert: '@src/app.ts' }),
    ).toEqual({ text: 'look at @src/app.ts and more', caret: 20 });
    expect(
      applyChoice({ text: 'look at @src/a', caret: 14, token, insert: '@src/app.ts' }),
    ).toEqual({ text: 'look at @src/app.ts ', caret: 20 });
  });
});
