import type {
  Decision,
  MicroUsd,
  PullRequestState,
  Reading,
  SittingTally,
  TaskPointState,
} from '@ibitsa/protocol';

/** Everything `record.md` says (§4.9, #167): core gathers it from state, the runtime writes it out. */
export interface CampaignRecordData {
  title: string;
  status: 'finished' | 'abandoned';
  /** The approved plan's summary; null for a quick quest. */
  summary: string | null;
  decisions: Decision[];
  islands: {
    name: string;
    branch: string;
    tasks: { title: string; state: TaskPointState }[];
    pullRequest: { number: number; url: string; state: PullRequestState } | null;
  }[];
  deferred: {
    /** Tasks that weren't done. */
    unfinished: string[];
    /** Reviewers' suggestions kept for later. */
    suggestions: { councillorId: string; message: string; file?: string; line?: number }[];
    /** "Revisit D…?" requests the user dismissed. */
    revisits: { councillorId: string; decisionId: string; message: string }[];
  };
  gold: Reading<MicroUsd>;
  tallies: SittingTally[];
  /** The elder's lessons; null without any (no reviews, or the session failed). */
  lessons: string[] | null;
}
