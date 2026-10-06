import { describe, expect, it } from 'vitest';
import { CommandHistory } from './command-history';

describe('CommandHistory (#81)', () => {
  it('steps back and forward, and returns to what you were typing', () => {
    const h = new CommandHistory();
    h.add('first');
    h.add('second');
    expect(h.previous('draft in progress')).toBe('second');
    expect(h.previous('second')).toBe('first');
    expect(h.previous('first')).toBeNull();
    expect(h.next()).toBe('second');
    expect(h.next()).toBe('draft in progress');
    expect(h.next()).toBeNull();
  });

  it('skips empty messages and repeats, keeps the newest within the limit', () => {
    const h = new CommandHistory({ entries: ['a', 'b', 'c'], limit: 3 });
    h.add('  ');
    h.add('c');
    h.add('d');
    expect(h.all).toEqual(['b', 'c', 'd']);
    expect(new CommandHistory({ entries: ['1', '2', '3', '4'], limit: 2 }).all).toEqual(['3', '4']);
  });

  it('sending starts browsing from the newest again', () => {
    const h = new CommandHistory({ entries: ['a', 'b'] });
    h.previous('');
    h.previous('b');
    h.add('c');
    expect(h.previous('')).toBe('c');
  });
});
