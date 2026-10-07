import type { ReviewView, Snapshot, TaskReviewView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { reviewersOf } from './reviewers';

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
