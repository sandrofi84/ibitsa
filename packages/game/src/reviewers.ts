import type { Snapshot } from '@ibitsa/protocol';
import type { PlateBox, ReviewerView } from './reviewers.types';

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

/** The gap kept between stacked name plates. */
const PLATE_GAP = 1;

/**
 * Where each name plate goes so none overlaps another (#234): the offset down from its own place, in
 * order. Plates keep their place while clear; a plate that would overlap one already placed moves down
 * a plate's height at a time until it's clear. So reviewers bunched at the hut's door show a neat stack
 * of names, and spread out at their task points every plate is back under its own token.
 */
export function stackPlates(plates: readonly PlateBox[]): number[] {
  const placed: PlateBox[] = [];
  return plates.map((plate) => {
    let dy = 0;
    const at = () => ({ ...plate, y: plate.y + dy });
    while (placed.some((other) => overlaps(at(), other))) dy += plate.height + PLATE_GAP;
    placed.push(at());
    return dy;
  });
}

function overlaps(a: PlateBox, b: PlateBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
