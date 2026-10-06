import type { ActionDraft } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { draftProblems, renamed } from './action-draft';

const draft = (over: Partial<ActionDraft> = {}): ActionDraft => ({
  name: 'pr-summary',
  description: 'Summarize the pull request',
  argumentHint: '',
  prompt: 'Summarize. $ARGUMENTS',
  target: 'hero',
  scope: 'personal',
  ...over,
});

describe('draftProblems (#86)', () => {
  it('accepts a complete draft', () => {
    expect(draftProblems(draft())).toEqual([]);
  });

  it('asks for a name, a description and a prompt', () => {
    expect(draftProblems(draft({ name: '', description: ' ', prompt: '' }))).toEqual([
      'Give the action a name.',
      'Say in a few words what the action does.',
      'Write the prompt the hero gets.',
    ]);
  });

  it('wants a skill-style name', () => {
    for (const name of ['PR Summary', 'pr_summary', '-pr', 'pr--summary', 'x'.repeat(65)]) {
      expect(draftProblems(draft({ name }))).toEqual([
        'Use lowercase letters, digits and single dashes for the name, e.g. pr-summary.',
      ]);
    }
  });
});

describe('renamed (#86)', () => {
  it('finds the next free name', () => {
    expect(renamed({ name: 'pr', taken: ['pr'] })).toBe('pr-2');
    expect(renamed({ name: 'pr', taken: ['pr', 'pr-2', 'pr-3'] })).toBe('pr-4');
  });
});
