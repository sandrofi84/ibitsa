import { type HeroView, heroHandle, type Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import {
  ALL,
  addressedHero,
  councilHandles,
  councilMessage,
  messageTargets,
  parseMessage,
  sittingHandles,
  sittingMessage,
} from './mentions';

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

describe('who a message goes to (#125)', () => {
  const hero = (
    id: string,
    { name, kind = 'idle' }: { name: string; kind?: HeroView['state']['kind'] },
  ) => ({ id, name, islandId: `i-${id}`, state: { kind } }) as HeroView;
  const heroes = [
    hero('h1', { name: 'Ranger Ilse', kind: 'working' }),
    hero('h2', { name: 'Rogue Vex' }),
    hero('h3', { name: 'Paladin Ada', kind: 'blocked' }),
  ];
  const ids = (text: string, selected: string | null = 'h1') =>
    messageTargets({ text, heroes, selected }).targets.map((h) => h.id);

  it('goes to the hero the @ names, by its handle even with spaces in the name', () => {
    expect(messageTargets({ text: '@rogue-vex add a test', heroes, selected: 'h1' })).toEqual({
      targets: [heroes[1]],
      text: 'add a test',
    });
  });

  it('goes to every hero with a session for @all, and to the selected hero without an @', () => {
    expect(ids('@all wrap up')).toEqual(['h1', 'h2']);
    expect(ids('carry on', 'h2')).toEqual(['h2']);
    expect(ids('carry on', null)).toEqual([]);
  });

  it("knows whose worktree a message is about: the named hero's, else the selected one, else the first", () => {
    expect(addressedHero({ text: '@rogue-vex /test', heroes, selected: 'h1' })?.id).toBe('h2');
    expect(addressedHero({ text: '/test', heroes, selected: 'h3' })?.id).toBe('h3');
    expect(addressedHero({ text: '/test', heroes, selected: 'gone' })?.id).toBe('h1');
    expect(addressedHero({ text: '/test', heroes: [], selected: null })).toBeNull();
  });
});

describe('asking the council mid-campaign (#169)', () => {
  const snapshot = (status: string, campaign = 'active') =>
    ({
      campaign: { status: campaign },
      sitting: { status, roster: [{ councillorId: 'security' }, { councillorId: 'tester' }] },
    }) as unknown as Snapshot;

  it('offers @council and each councillor who sat, once the plan is approved and under way', () => {
    expect(councilHandles(snapshot('approved'))).toEqual(['council', 'security', 'tester']);
    expect(councilHandles(snapshot('deliberating'))).toEqual([]);
    expect(councilHandles(snapshot('approved', 'finished'))).toEqual([]);
    expect(councilHandles(null)).toEqual([]);
  });

  it('reads @council as the whole council and @<id> as one councillor; anything else is for heroes', () => {
    const s = snapshot('approved');
    expect(councilMessage({ text: '@council how are we doing?', snapshot: s })).toEqual({
      councillorId: null,
      text: 'how are we doing?',
    });
    expect(councilMessage({ text: 'look at @src/a.ts @security please', snapshot: s })).toEqual({
      councillorId: 'security',
      text: 'look at @src/a.ts please',
    });
    expect(councilMessage({ text: '@ranger-ilse carry on', snapshot: s })).toBeNull();
    expect(councilMessage({ text: '@council', snapshot: s })).toBeNull();
    expect(councilMessage({ text: '@council hi', snapshot: snapshot('deliberating') })).toBeNull();
  });
});

describe('talking to the council while it sits (#242)', () => {
  const snapshot = (status: string) =>
    ({
      campaign: { status: 'planning' },
      sitting: { status, roster: [{ councillorId: 'security' }] },
    }) as unknown as Snapshot;

  it('offers @council and each councillor on the roster only while the council plans', () => {
    expect(sittingHandles(snapshot('deliberating'))).toEqual(['council', 'security']);
    expect(sittingHandles(snapshot('awaitingApproval'))).toEqual(['council', 'security']);
    expect(sittingHandles(snapshot('approved'))).toEqual([]);
    expect(sittingHandles(null)).toEqual([]);
  });

  it('sends every message to the council, to one councillor when an @ names it', () => {
    const s = snapshot('deliberating');
    expect(sittingMessage({ text: 'Plan it here anyway', snapshot: s })).toEqual({
      councillorId: null,
      text: 'Plan it here anyway',
    });
    expect(sittingMessage({ text: '@council carry on', snapshot: s })).toEqual({
      councillorId: null,
      text: 'carry on',
    });
    expect(sittingMessage({ text: '@security is it safe?', snapshot: s })).toEqual({
      councillorId: 'security',
      text: 'is it safe?',
    });
    expect(sittingMessage({ text: '@security', snapshot: s })).toBeNull();
    expect(sittingMessage({ text: 'hi', snapshot: snapshot('dismissed') })).toBeNull();
  });
});
