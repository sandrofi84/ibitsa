import type { Finding, TaskReviewView } from '@ibitsa/protocol';
import type { FindingLine, ReviewRound } from './task-review.types';

const KINDS: Record<NonNullable<Finding['kind']>, string> = {
  bug: 'A bug',
  security: 'A security problem',
  breaks: 'Breaks something that worked',
};

/** How a finding reads in the task panel and Needs you (§5.5): severity, why, where, what. */
export function findingLine(finding: Finding): FindingLine {
  const why = finding.criterion
    ? `Fails “${finding.criterion}”`
    : finding.kind
      ? KINDS[finding.kind]
      : null;
  const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : null;
  return {
    severity: finding.severity === 'blocking' ? 'Blocking' : 'Suggestion',
    why,
    where,
    message: finding.message,
    revisit: finding.revisit ? `Asks to revisit ${finding.revisit}` : null,
  };
}

/** A finding on one line, for a Needs you item. */
export function findingText(finding: Finding): string {
  const line = findingLine(finding);
  return [line.why, line.where, line.message].filter(Boolean).join(' · ');
}

/** The review's rounds, oldest first, each with the reviews that ran in it. */
export function roundsOf(review: TaskReviewView): ReviewRound[] {
  const rounds = new Map<number, ReviewRound>();
  for (const r of review.reviews) {
    const round = rounds.get(r.round) ?? { round: r.round, reviews: [] };
    round.reviews.push(r);
    rounds.set(r.round, round);
  }
  return [...rounds.values()].sort((a, b) => a.round - b.round);
}

/** Where the review stands, in a few words. */
export function phaseText(review: TaskReviewView): string {
  switch (review.phase) {
    case 'checks':
      return 'Running the checks';
    case 'reviewing':
      return `Being reviewed (round ${review.round})`;
    case 'changes':
      return `Sent back to the hero (round ${review.round} next)`;
    case 'escalated':
      return 'Waiting for you';
    case 'passed':
      return 'Passed review';
  }
}
