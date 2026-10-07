import type { ReviewView, TaskReviewView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { findingLine, findingText, phaseText, roundsOf } from './task-review';

const review = (id: string, round: number): ReviewView => ({
  id,
  councillorId: 'tester',
  effort: 'light',
  round,
  status: 'done',
  verdict: { verdict: 'pass', findings: [] },
  error: null,
  gold: { kind: 'unknown' },
});

describe('task review formatting (#141)', () => {
  it('says why a finding blocks, where, and whether it asks to revisit a decision', () => {
    expect(
      findingLine({
        severity: 'blocking',
        criterion: 'It has a test',
        file: 'src/app.ts',
        line: 12,
        message: 'No test for the redirect',
      }),
    ).toEqual({
      severity: 'Blocking',
      why: 'Fails “It has a test”',
      where: 'src/app.ts:12',
      message: 'No test for the redirect',
      revisit: null,
    });
    expect(
      findingLine({ severity: 'blocking', kind: 'security', file: 'a.ts', message: 'm' }),
    ).toMatchObject({
      why: 'A security problem',
      where: 'a.ts',
    });
    expect(findingLine({ severity: 'suggestion', message: 'Rename it', revisit: 'D1' })).toEqual({
      severity: 'Suggestion',
      why: null,
      where: null,
      message: 'Rename it',
      revisit: 'Asks to revisit D1',
    });
    expect(
      findingText({
        severity: 'blocking',
        kind: 'breaks',
        file: 'b.ts',
        line: 3,
        message: 'It crashes',
      }),
    ).toBe('Breaks something that worked · b.ts:3 · It crashes');
    expect(findingText({ severity: 'blocking', kind: 'bug', message: 'Off by one' })).toBe(
      'A bug · Off by one',
    );
  });

  it('groups reviews by round, oldest first', () => {
    const rounds = roundsOf({
      round: 2,
      phase: 'passed',
      checks: null,
      reviews: [review('r1', 1), review('r2', 1), review('r3', 2)],
      suggestions: [],
    });
    expect(rounds.map((r) => [r.round, r.reviews.map((v) => v.id)])).toEqual([
      [1, ['r1', 'r2']],
      [2, ['r3']],
    ]);
  });

  it('says where the review stands', () => {
    const at = (phase: TaskReviewView['phase']) =>
      phaseText({ round: 2, phase, checks: null, reviews: [], suggestions: [] });
    expect(
      ['checks', 'reviewing', 'changes', 'escalated', 'passed'].map((p) =>
        at(p as TaskReviewView['phase']),
      ),
    ).toEqual([
      'Running the checks',
      'Being reviewed (round 2)',
      'Sent back to the hero (round 2 next)',
      'Waiting for you',
      'Passed review',
    ]);
  });
});
