// An island's branch on the git host and its pull request (spec §5.6, M6).

/** A PR's badge: what the git host says, reduced to one state. */
export type PullRequestState =
  | 'draft'
  | 'open'
  | 'approved'
  | 'changesRequested'
  | 'checksFailing'
  | 'merged'
  | 'closed';

/** The island's branch on the git host: what was pushed, what's under way, and its PR. */
export interface IslandRemoteView {
  /** The commit last pushed; null before any push. */
  pushedHead: string | null;
  /** What's under way; one thing at a time. */
  busy: 'pushing' | 'opening' | 'markingReady' | null;
  /** The last push or PR action that failed, until the next one starts. */
  error: string | null;
  pullRequest: { number: number; url: string; state: PullRequestState; base: string } | null;
}

/** What the preview form starts from (§5.6): built from the record, with no tokens. */
export interface PullRequestDraft {
  title: string;
  body: string;
  /** Not editable: the island before (stacked) or the campaign's base. */
  base: string;
  /** Ticked until the island is cleared; it can't be unticked before. */
  draft: boolean;
  /** Ready for review is allowed: every task has passed. */
  cleared: boolean;
  /** Why the PR can't open yet, from core's rules (the git host adds its own reasons). */
  cannotOpen: string | null;
}

/** One PR as the git host reports it when polled. */
export interface PolledPullRequest {
  number: number;
  state: PullRequestState;
}
