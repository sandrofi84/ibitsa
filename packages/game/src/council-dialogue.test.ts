import type { DialogueLine } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { CouncilDialogue } from './council-dialogue';
import type { DialogueBatch } from './council-dialogue.types';

const batch: DialogueBatch = {
  batchId: 'b6',
  items: [
    {
      id: 'q7',
      councillorId: 'architect',
      question: 'Which sign-in methods?',
      options: [
        { id: 'email', label: 'Email and password', tradeoff: 'Smallest change' },
        { id: 'google', label: 'Email + Google', tradeoff: 'OAuth setup' },
      ],
      recommendation: { optionId: 'email', reason: 'No third party' },
      allowFreeText: false,
    },
    {
      id: 'q8',
      councillorId: 'security',
      question: 'How long should a session last?',
      options: [],
      allowFreeText: true,
    },
  ],
};

describe('CouncilDialogue (#102)', () => {
  it('steps through the batch, and gives every answer once all are in', () => {
    const d = new CouncilDialogue(batch);
    expect(d.step([])).toMatchObject({ position: 1, count: 2, answer: null });
    expect([d.isFirst, d.isLast, d.answered]).toEqual([true, false, false]);
    expect(d.toAnswers()).toBeNull();

    d.choose('google');
    d.choose('email');
    expect(d.step([]).answer).toEqual({ optionId: 'email' });
    d.next();
    expect(d.step([])).toMatchObject({ position: 2, question: { id: 'q8' }, answer: null });
    expect(d.toAnswers()).toBeNull();
    d.write('  A week  ');
    expect([d.isLast, d.answered]).toEqual([true, true]);
    expect(d.toAnswers()).toEqual({ q7: { optionId: 'email' }, q8: { text: 'A week' } });

    // Going back keeps what was answered.
    d.back();
    expect(d.step([]).answer).toEqual({ optionId: 'email' });
    d.back();
    expect(d.isFirst).toBe(true);
    d.next();
    d.next();
    d.next();
    expect(d.step([]).position).toBe(2);
  });

  it('ignores options a question lacks, and free text where it isn’t allowed', () => {
    const d = new CouncilDialogue(batch);
    d.choose('github');
    d.write('Passkeys');
    expect(d.answered).toBe(false);
  });

  it('clears a written answer when the text is emptied, but not a chosen option', () => {
    const d = new CouncilDialogue({
      batchId: 'b1',
      items: [{ ...batch.items[0], allowFreeText: true } as DialogueBatch['items'][number]],
    });
    d.write('Passkeys');
    expect(d.step([]).answer).toEqual({ text: 'Passkeys' });
    d.write('  ');
    expect(d.answered).toBe(false);
    d.choose('email');
    d.write('');
    expect(d.step([]).answer).toEqual({ optionId: 'email' });
  });

  it('shows the lines about the current question and the chime-ins after them', () => {
    const lines: DialogueLine[] = [
      { id: 'd1', speaker: 'you', text: 'Why?', questionId: 'q7' },
      { id: 'd2', speaker: 'architect', text: 'Fewer moving parts.', questionId: 'q7' },
      { id: 'd3', speaker: 'security', text: 'And fewer secrets.' },
      { id: 'd4', speaker: 'you', text: 'Why?', questionId: 'q8' },
      { id: 'd5', speaker: 'security', text: 'Stolen sessions.', questionId: 'q8' },
      { id: 'd6', speaker: 'elder', text: 'Noted.' },
    ];
    const d = new CouncilDialogue(batch);
    expect(d.step(lines).lines.map((l) => l.id)).toEqual(['d1', 'd2', 'd3']);
    d.next();
    expect(d.step(lines).lines.map((l) => l.id)).toEqual(['d4', 'd5', 'd6']);
  });
});
