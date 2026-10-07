import type { PullRequestState } from '@ibitsa/protocol';

/** An island's PR badge on the map (§5.6): a word as well as a colour, never colour alone. */
export interface PullRequestBadge {
  /** `none`: the island can open a PR but has none yet. */
  state: PullRequestState | 'none';
  /** What the map shows, e.g. `#12 DRAFT`. */
  label: string;
  color: number;
}

/** A button on the PR card; `disabled` says why it can't be used now. */
export interface PullRequestAction {
  id: 'open' | 'update' | 'markReady' | 'push' | 'refresh';
  label: string;
  disabled: string | null;
}

/** What the PR card shows for an island. */
export interface PullRequestCardModel {
  heading: string;
  /** The PR's state in words, or what the island can do without one. */
  status: string;
  url: string | null;
  /** What's under way (pushing, opening, marking ready). */
  busy: string | null;
  error: string | null;
  actions: PullRequestAction[];
}
