import type { Snapshot } from '@ibitsa/protocol';
import type { ReviewerView } from './reviewers.types';

/**
 * The councillors to show on the map (§5.5, #140): while a task is being reviewed, everyone reviewing it
 * this round; once the round is over (passed, sent back, escalated), the same councillors, leaving, so
 * their verdicts are seen before they walk back to the hut. Nobody shows while the checks run.
 */
export function reviewersOf(snapshot: Snapshot): ReviewerView[] {
  return snapshot.islands.flatMap((island) =>
    island.taskPoints.flatMap((tp) => {
      const review = tp.review;
      if (!review || review.phase === 'checks' || review.reviews.length === 0) return [];
      const round =
        review.phase === 'reviewing'
          ? review.round
          : Math.max(...review.reviews.map((r) => r.round));
      return review.reviews
        .filter((r) => r.round === round)
        .map((r, index) => ({
          key: `${tp.id}:${r.councillorId}:${r.round}`,
          taskPointId: tp.id,
          councillorId: r.councillorId,
          round: r.round,
          status: r.status,
          findings: (r.verdict?.findings ?? []).filter((f) => f.severity === 'blocking').length,
          leaving: review.phase !== 'reviewing',
          index,
        }));
    }),
  );
}
