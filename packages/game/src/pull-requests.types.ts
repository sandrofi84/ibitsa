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
  id: 'open' | 'update' | 'markReady' | 'push' | 'refresh' | 'comments' | 'restack' | 'remove';
  label: string;
  disabled: string | null;
  /** A second click confirms (#154): what the button says after the first. */
  confirm?: string;
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
  /** Signed out of the git host (#162): a PR action will ask to sign in. */
  signIn: string | null;
  /** Stacked, after the island before merged (#154): what restacking does, or what the hero is fixing. */
  restack: string | null;
  actions: PullRequestAction[];
}
