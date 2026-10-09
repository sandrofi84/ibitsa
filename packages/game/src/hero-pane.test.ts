import type { JournalEntry } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { paneTurn, replyTo } from './hero-pane';

type Line = { t: number; text: string; heroId?: string };

const said = ({ t, text, heroId = 'h1' }: Line): JournalEntry => ({
  t,
  heroId,
  kind: 'said',
  text,
});
const you = ({ t, text, heroId = 'h1' }: Line): JournalEntry => ({
  t,
  heroId,
  kind: 'you',
  text,
  priority: 'next',
});
const texts = (entries: readonly JournalEntry[]) =>
  entries.map((e) => ('text' in e ? e.text : e.kind));

describe('replyTo (#262)', () => {
  it('is what the hero said after your last message to it, in order', () => {
    const journal: JournalEntry[] = [
      said({ t: 1, text: 'Starting.' }),
      you({ t: 2, text: 'What did you do?' }),
      { t: 3, heroId: 'h1', kind: 'tool', activity: 'read', outcome: 'ok' },
      said({ t: 4, text: 'I ran the tests first.' }),
      said({ t: 5, text: 'Then I fixed slug.mjs.' }),
    ];
    expect(texts(replyTo({ journal, heroId: 'h1' }))).toEqual([
      'I ran the tests first.',
      'Then I fixed slug.mjs.',
    ]);
  });

  it('answers only the latest message', () => {
    const journal = [
      you({ t: 1, text: 'First?' }),
      said({ t: 2, text: 'One.' }),
      you({ t: 3, text: 'Second?' }),
      said({ t: 4, text: 'Two.' }),
    ];
    expect(texts(replyTo({ journal, heroId: 'h1' }))).toEqual(['Two.']);
  });

  it('is empty while you have not written, or the hero has not answered yet', () => {
    const hello = said({ t: 1, text: 'Hello.' });
    expect(replyTo({ journal: [hello], heroId: 'h1' })).toEqual([]);
    expect(replyTo({ journal: [hello, you({ t: 2, text: 'Hi?' })], heroId: 'h1' })).toEqual([]);
  });

  it("leaves out another hero's lines and messages", () => {
    const journal = [
      you({ t: 1, text: 'Status?' }),
      said({ t: 2, text: 'Mine.', heroId: 'h2' }),
      you({ t: 3, text: 'You?', heroId: 'h2' }),
    ];
    expect(replyTo({ journal, heroId: 'h1' })).toEqual([]);
    expect(replyTo({ journal, heroId: 'h2' })).toEqual([]);
    const other = [
      you({ t: 1, text: 'Status?', heroId: 'h2' }),
      said({ t: 2, text: 'Fine.', heroId: 'h2' }),
    ];
    expect(texts(replyTo({ journal: other, heroId: 'h2' }))).toEqual(['Fine.']);
  });
});

describe('paneTurn (#263)', () => {
  const first = { id: 'c1', status: 'active' } as const;

  it('collapses once the campaign it showed ends', () => {
    expect(paneTurn({ was: first, now: { id: 'c1', status: 'finished' } })).toBe('collapse');
    expect(paneTurn({ was: first, now: { id: 'c1', status: 'abandoned' } })).toBe('collapse');
  });

  it("reopens for the next campaign's work, whether it plans first or not", () => {
    const ended = { id: 'c1', status: 'finished' } as const;
    const planning = { id: 'c2', status: 'planning' } as const;
    expect(paneTurn({ was: ended, now: planning })).toBeNull();
    expect(paneTurn({ was: planning, now: { id: 'c2', status: 'active' } })).toBe('reopen');
    expect(paneTurn({ was: ended, now: { id: 'c2', status: 'active' } })).toBe('reopen');
  });

  it('does nothing on a first look, while the campaign carries on, or with none', () => {
    expect(paneTurn({ was: null, now: { id: 'c1', status: 'finished' } })).toBeNull();
    expect(paneTurn({ was: null, now: first })).toBeNull();
    expect(paneTurn({ was: first, now: first })).toBeNull();
    expect(paneTurn({ was: first, now: null })).toBeNull();
  });
});
