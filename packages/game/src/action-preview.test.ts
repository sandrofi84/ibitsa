import type { ActionInfo } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { findAction, parseAction } from './action-preview';

describe('parseAction (#85)', () => {
  const recipients = ['ranger-ilse', 'all'];
  it('reads an action, its arguments, and a recipient in front', () => {
    expect(parseAction({ text: '/test unit api', recipients })).toEqual({
      prefix: '',
      name: 'test',
      args: 'unit api',
    });
    expect(parseAction({ text: '@ranger-ilse /explain', recipients })).toEqual({
      prefix: '@ranger-ilse ',
      name: 'explain',
      args: '',
    });
    expect(parseAction({ text: '/pr alice\nbob ', recipients })?.args).toBe('alice\nbob');
  });

  it('is not an action mid-message, after an unknown recipient, or as a path', () => {
    expect(parseAction({ text: 'please /test', recipients })).toBeNull();
    expect(parseAction({ text: '@stranger /test', recipients })).toBeNull();
    expect(parseAction({ text: '/src/app.ts', recipients })).toBeNull();
  });
});

describe('findAction (#85)', () => {
  const actions = [
    { name: 'ibitsa:test', aliases: ['test'] },
    { name: 'pr', aliases: [] },
  ] as unknown as ActionInfo[];
  it('finds by name or alias', () => {
    expect(findAction({ actions, name: 'test' })?.name).toBe('ibitsa:test');
    expect(findAction({ actions, name: 'pr' })?.name).toBe('pr');
    expect(findAction({ actions, name: 'nope' })).toBeNull();
  });
});
