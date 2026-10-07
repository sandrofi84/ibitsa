import type { Effect } from '@ibitsa/core';
import type { Verdict } from '@ibitsa/protocol';
import type { DemoReviewOptions } from './demo-review.types';

const PACE_MS = 1_000;

/**
 * Dev only (#140): reviews in the live host (`?fixture=live&review=demo`). The checks pass, and each
 * councillor's verdict comes in after a while: in the first round the first councillor started for a
 * task asks for changes with two blocking findings and the others pass; every later round passes. Paced
 * slowly so the councillors can be watched walking out; the review paths themselves (escalation, dispute,
 * revisit, a failing check) are the live host's scripted reviews (#141, `reviewScript=`).
 */
export class DemoReview {
  private readonly input: DemoReviewOptions['input'];
  private readonly t: () => number;
  private readonly pace: number;
  /** The task points whose first round already has its critic. */
  private readonly critics = new Set<string>();
  private calls = 0;

  constructor({ input, t, pace = PACE_MS }: DemoReviewOptions) {
    this.input = input;
    this.t = t;
    this.pace = pace;
  }

  /** Answers a review effect; false when it isn't one this demo plays. */
  perform(effect: Effect): boolean {
    if (effect.type === 'runChecks') {
      setTimeout(
        () =>
          this.input({
            kind: 'gm',
            t: this.t(),
            event: {
              type: 'checksRan',
              taskPointId: effect.taskPointId,
              results: [{ command: 'pnpm test', ok: true, output: 'All tests passed.' }],
            },
          }),
        this.pace / 2,
      );
      return true;
    }
    if (effect.type === 'startReview') {
      const critic = effect.round === 1 && !this.critics.has(effect.taskPointId);
      if (critic) this.critics.add(effect.taskPointId);
      const reviewId = effect.reviewId;
      setTimeout(
        () =>
          this.input({
            kind: 'review',
            t: this.t(),
            reviewId,
            event: { type: 'sessionStarted', sessionId: `demo-${reviewId}` },
          }),
        this.pace / 4,
      );
      // Staggered, so the councillors finish one after another once they've walked out.
      setTimeout(
        () => {
          const event = {
            type: 'verdictSubmitted' as const,
            toolUseId: `verdict-${reviewId}`,
            verdict: critic ? CHANGES : PASS,
          };
          this.input({ kind: 'review', t: this.t(), reviewId, event });
          this.input({
            kind: 'review',
            t: this.t(),
            reviewId,
            event: { type: 'usage', totalCost: 40_000 },
          });
        },
        this.pace * (4 + (this.calls++ % 3)),
      );
      return true;
    }
    return false;
  }
}

const CHANGES: Verdict = {
  verdict: 'changes',
  findings: [
    {
      severity: 'blocking',
      kind: 'security',
      file: 'src/app.ts',
      line: 12,
      message: 'The redirect target is taken from the query string unchecked.',
    },
    {
      severity: 'blocking',
      kind: 'bug',
      file: 'src/app.ts',
      line: 30,
      message: 'A failed sign-in still sets the session cookie.',
    },
    { severity: 'suggestion', message: 'Name the redirect helper for what it checks.' },
  ],
};

const PASS: Verdict = {
  verdict: 'pass',
  findings: [{ severity: 'suggestion', message: 'A comment on the retry would help.' }],
};
