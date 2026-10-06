import { describe, expect, it } from 'vitest';
import { ALL, heroHandle, parseMessage } from './mentions';

const recipients = ['ranger-ilse', ALL];

describe('heroHandle (#83)', () => {
  it('turns a name into a handle', () => {
    expect(heroHandle('Ranger Ilse')).toBe('ranger-ilse');
    expect(heroHandle('  Rogue  Vex! ')).toBe('rogue-vex');
  });
});

describe('parseMessage (#83)', () => {
  it('takes the first recipient out and keeps file references', () => {
    expect(
      parseMessage({ text: '@ranger-ilse look at @src/app.ts and @README.md', recipients }),
    ).toEqual({ recipient: 'ranger-ilse', text: 'look at @src/app.ts and @README.md' });
  });

  it('finds a recipient anywhere, and only the first', () => {
    expect(parseMessage({ text: 'please @all stop @ranger-ilse', recipients })).toEqual({
      recipient: ALL,
      text: 'please stop @ranger-ilse',
    });
  });

  it('has no recipient without a matching mention; an email address is not a mention', () => {
    expect(parseMessage({ text: ' check @docs/a.md ', recipients })).toEqual({
      recipient: null,
      text: 'check @docs/a.md',
    });
    expect(parseMessage({ text: 'mail ada@ranger-ilse', recipients }).recipient).toBeNull();
  });
});
