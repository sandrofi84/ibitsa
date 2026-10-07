import type { Effort } from './commands.schema';
import type { Finding, Verdict } from './review.schema';
import type { MicroUsd, Reading } from './values.types';

/** What a reviewer's session reports (spec §5.5); core hears it as `review` inputs. */
export type ReviewEvent =
  | { type: 'sessionStarted'; sessionId: string }
  /** A `submit_verdict` call; core answers it with `completeReviewTool`. */
  | { type: 'verdictSubmitted'; toolUseId: string; verdict: Verdict }
  /** Running total for this review, never a delta. */
  | { type: 'usage'; totalCost: MicroUsd }
  /** The review can't finish. */
  | { type: 'error'; message: string };

/** One check command and how it went (§5.5 step 2). */
export interface CheckResult {
  command: string;
  ok: boolean;
  /** The last part of its output. */
  output: string;
}

/** One reviewer's review of one round. */
export interface ReviewView {
  id: string;
  councillorId: string;
  effort: Effort;
  round: number;
  status: 'running' | 'done' | 'failed';
  verdict: Verdict | null;
  error: string | null;
  gold: Reading<MicroUsd>;
}

/** A task's checks and reviews (§5.5), for the map and the task panel. */
export interface TaskReviewView {
  /** 1 for the first review; each send-back starts the next. */
  round: number;
  phase: 'checks' | 'reviewing' | 'changes' | 'escalated' | 'passed';
  checks: CheckResult[] | null;
  reviews: ReviewView[];
  /** Every suggestion so far, for the PR description (M6). */
  suggestions: (Finding & { councillorId: string })[];
}
