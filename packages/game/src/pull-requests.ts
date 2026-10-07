import type { IslandView, PullRequestState } from '@ibitsa/protocol';
import type {
  PullRequestAction,
  PullRequestBadge,
  PullRequestCardModel,
} from './pull-requests.types';

// An island's pull request as the game shows it (spec §5.6, #153): the badge on the map and the PR
// card's words and buttons. Plain functions of the snapshot; the rules themselves are core's.

/** The PR states in words, as the card and the badge say them. */
export const PR_STATES: Record<PullRequestState, { text: string; short: string; color: number }> = {
  draft: { text: 'Draft', short: 'DRAFT', color: 0x9a9a9a },
  open: { text: 'Open', short: 'OPEN', color: 0x3fb950 },
  approved: { text: 'Approved', short: 'APPROVED', color: 0x2f81f7 },
  changesRequested: { text: 'Changes requested', short: 'CHANGES', color: 0xd29922 },
  checksFailing: { text: 'Checks failing', short: 'FAILING', color: 0xe8483a },
  merged: { text: 'Merged', short: 'MERGED', color: 0x8957e5 },
  closed: { text: 'Closed', short: 'CLOSED', color: 0x6e5a5a },
};

const BUSY: Record<NonNullable<NonNullable<IslandView['remote']>['busy']>, string> = {
  pushing: 'Pushing…',
  opening: 'Opening the pull request…',
  markingReady: 'Marking it ready for review…',
};

const WAIT = 'Wait for the push to finish.';

/** Every task on the island is done: it may be ready for review. */
export function cleared(island: IslandView): boolean {
  return island.taskPoints.every((tp) => tp.state === 'done' || tp.state === 'doneUnreviewed');
}

/** The island's badge: its PR's state, a plain "PR" while it could open one, else none. */
export function badgeOf(island: IslandView): PullRequestBadge | null {
  const pr = island.remote?.pullRequest;
  if (pr) {
    const s = PR_STATES[pr.state];
    return { state: pr.state, label: `#${pr.number} ${s.short}`, color: s.color };
  }
  if (!island.pullRequestDraft) return null;
  return { state: 'none', label: 'PR', color: 0x5a4a3a };
}

/** The PR card: the PR's state and link, what's under way, the last failure, and the buttons. */
export function cardOf(island: IslandView): PullRequestCardModel {
  const remote = island.remote;
  const pr = remote?.pullRequest ?? null;
  const busy = remote?.busy ? WAIT : null;
  const actions: PullRequestAction[] = [];
  if (!pr) {
    const draft = island.pullRequestDraft;
    const missing = draft ? null : 'This island has no worktree.';
    actions.push({
      id: 'open',
      label: 'Open PR',
      disabled: missing ?? busy ?? draft?.cannotOpen ?? null,
    });
    actions.push({ id: 'push', label: 'Push branch only', disabled: missing ?? busy });
  } else if (pr.state !== 'merged' && pr.state !== 'closed') {
    actions.push({ id: 'update', label: 'Update PR', disabled: busy });
    if (pr.state === 'draft') {
      actions.push({
        id: 'markReady',
        label: 'Mark ready for review',
        disabled: busy ?? (cleared(island) ? null : 'Every task on the island has to pass first.'),
      });
    }
    actions.push({ id: 'refresh', label: 'Refresh', disabled: null });
  }
  return {
    heading: pr ? `Pull request #${pr.number}` : 'Pull request',
    status: pr
      ? `${PR_STATES[pr.state].text}, into ${pr.base}`
      : remote?.pushedHead
        ? 'Branch pushed; no pull request yet.'
        : 'No pull request yet.',
    url: pr?.url ?? null,
    busy: remote?.busy ? BUSY[remote.busy] : null,
    error: remote?.error ?? null,
    actions,
  };
}
