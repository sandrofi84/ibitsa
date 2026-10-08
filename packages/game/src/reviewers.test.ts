import type { ReviewView, Snapshot, TaskReviewView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { reviewersOf, stackPlates } from './reviewers';

const review = (
  councillorId: string,
  {
    round = 1,
    status = 'running',
    blocking = 0,
  }: Partial<{ round: number; status: ReviewView['status']; blocking: number }> = {},
): ReviewView => ({
  id: `${councillorId}-${round}`,
  councillorId,
  effort: 'light',
  round,
  status,
  verdict:
    status === 'done'
      ? {
          verdict: blocking > 0 ? 'changes' : 'pass',
          findings: [
            ...Array.from({ length: blocking }, () => ({
              severity: 'blocking' as const,
              kind: 'bug' as const,
              message: 'x',
            })),
            { severity: 'suggestion' as const, message: 'nit' },
          ],
        }
      : null,
  error: null,
  gold: { kind: 'unknown' },
});

const snapshotWith = (r: TaskReviewView | null): Snapshot =>
  ({
    islands: [
      {
        id: 'i',
        taskPoints: [
          { id: 't1', title: 'T', state: 'underReview', review: r },
          { id: 't2', title: 'U', state: 'locked' },
        ],
      },
    ],
  }) as unknown as Snapshot;

const of = (r: Partial<TaskReviewView>) =>
  reviewersOf(
    snapshotWith({
      round: 1,
      phase: 'reviewing',
      checks: null,
      reviews: [],
      suggestions: [],
      ...r,
    }),
  );

describe('reviewersOf (#140)', () => {
  it('shows nobody before a review, or while the checks run', () => {
    expect(reviewersOf(snapshotWith(null))).toEqual([]);
    expect(of({ phase: 'checks', reviews: [review('security')] })).toEqual([]);
    expect(of({ reviews: [] })).toEqual([]);
  });

  it("shows this round's reviewers while reviewing, with their blocking findings once they're in", () => {
    const shown = of({
      round: 2,
      reviews: [
        review('security', { status: 'done', blocking: 1 }),
        review('security', { round: 2 }),
        review('tester', { round: 2, status: 'failed' }),
      ],
    });
    expect(shown).toEqual([
      {
        key: 't1:security:2',
        taskPointId: 't1',
        councillorId: 'security',
        round: 2,
        status: 'running',
        findings: 0,
        leaving: false,
        index: 0,
      },
      {
        key: 't1:tester:2',
        taskPointId: 't1',
        councillorId: 'tester',
        round: 2,
        status: 'failed',
        findings: 0,
        leaving: false,
        index: 1,
      },
    ]);
  });

  it('shows the last round leaving once it is over: sent back, passed or escalated', () => {
    for (const phase of ['changes', 'passed', 'escalated'] as const) {
      const shown = of({
        round: phase === 'changes' ? 2 : 1,
        phase,
        reviews: [
          review('security', { status: 'done', blocking: 2 }),
          review('tester', { status: 'done' }),
        ],
      });
      expect(shown.map((r) => [r.key, r.findings, r.leaving])).toEqual([
        ['t1:security:1', 2, true],
        ['t1:tester:1', 0, true],
      ]);
    }
  });
});

describe('stackPlates (#234)', () => {
  const plate = (x: number, y: number) => ({ x, y, width: 30, height: 10 });

  it('leaves plates that are clear of each other in their own place', () => {
    expect(stackPlates([plate(0, 0), plate(40, 0), plate(0, 20)])).toEqual([0, 0, 0]);
  });

  it('stacks plates bunched in one spot down a plate at a time, in order', () => {
    // Three reviewers leaving the hut's door together: the same spot, one name under the other.
    expect(stackPlates([plate(10, 5), plate(10, 5), plate(10, 5)])).toEqual([0, 11, 22]);
  });

  it('moves a plate only as far as it needs, past every plate it would cover', () => {
    // The second overlaps the first and moves under it; the third, clear of the first but over the
    // second's new place, moves just under that.
    expect(stackPlates([plate(0, 0), plate(20, 4), plate(25, 14)])).toEqual([0, 11, 11]);
  });

  it('treats plates that only touch as clear', () => {
    expect(stackPlates([plate(0, 0), plate(30, 0), plate(0, 10)])).toEqual([0, 0, 0]);
  });

  it('places nothing for no plates', () => {
    expect(stackPlates([])).toEqual([]);
  });
});
