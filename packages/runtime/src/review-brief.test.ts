import { describe, expect, it } from 'vitest';
import type { ReviewStart } from './ports.types';
import { reviewBrief } from './review-brief';

const start: ReviewStart = {
  cwd: '/wt',
  councillorId: 'security',
  model: 'sonnet',
  maxBudgetMicroUsd: 400_000,
  round: 1,
  diff: 'diff --git a/x b/x',
  task: { title: 'Hash passwords', description: 'Store hashes, never the passwords.' },
  criteria: ['Passwords are hashed'],
  decisions: [
    {
      id: 'D1',
      title: 'Hashing',
      raisedBy: 'security',
      chosen: 'bcrypt',
      alternatives: [],
      why: 'Battle-tested',
      affects: ['T1'],
    },
  ],
  checks: [
    { command: 'pnpm test', ok: true, output: '' },
    { command: 'pnpm lint', ok: false, output: 'x.ts: unused' },
  ],
};

describe('reviewBrief (§5.5, #201)', () => {
  it('briefs a first round with the guidance, task, criteria, decisions, checks and diff', () => {
    const text = reviewBrief({
      start,
      guidance: { title: 'Security', guidance: 'Look for injection.' },
    });
    expect(text.split('\n\n---\n\n')).toEqual([
      'You are security (Security), reviewing round 1 of this task.\n\nLook for injection.',
      'The task: Hash passwords\nStore hashes, never the passwords.',
      'Your acceptance criteria for it:\n- Passwords are hashed',
      "Decisions already taken (don't block on these):\n- D1 Hashing: bcrypt. Battle-tested",
      'The checks:\n- `pnpm test`: passed\n- `pnpm lint`: failed\nx.ts: unused',
      "The task's changes:\n\ndiff --git a/x b/x",
    ]);
  });

  it('says what is missing, and from round 2 shows only what changed', () => {
    const text = reviewBrief({
      start: { ...start, round: 2, criteria: [], decisions: [], checks: [], diff: '' },
      guidance: null,
    });
    expect(text.split('\n\n---\n\n')).toEqual([
      'You are security, reviewing round 2 of this task.\n\n(No skill file found: review from your name and the criteria.)',
      'The task: Hash passwords\nStore hashes, never the passwords.',
      'Your acceptance criteria for it:\n(none: review for bugs, security and things that broke)',
      "Decisions already taken (don't block on these):\n(none)",
      'The checks:\n(none ran)',
      'What changed since your last review:\n\n(empty diff)',
    ]);
  });
});
