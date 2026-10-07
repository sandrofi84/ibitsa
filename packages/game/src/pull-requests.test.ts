import type { GitHostView, IslandView, PullRequestDraft, PullRequestState } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { badgeOf, cardOf, cleared } from './pull-requests';

const card = (island: IslandView, host?: GitHostView) => cardOf({ island, host });

const DRAFT: PullRequestDraft = {
  title: 'Accent-free slugs',
  body: 'Slugs without accents.',
  base: 'main',
  draft: true,
  cleared: false,
  cannotOpen: null,
};

function island(change: Partial<IslandView> = {}): IslandView {
  return {
    id: 'i1',
    name: 'Accent-free slugs',
    branch: 'ibitsa/accent-free-slugs',
    worktree: 'ready',
    basedOn: null,
    behind: false,
    taskPoints: [
      { id: 't1', title: 'Strip', state: 'doneUnreviewed' },
      { id: 't2', title: 'Test', state: 'active' },
    ],
    remote: null,
    pullRequestDraft: DRAFT,
    ...change,
  };
}

const withPr = (state: PullRequestState) =>
  island({
    pullRequestDraft: null,
    remote: {
      pushedHead: 'abc',
      busy: null,
      error: null,
      pullRequest: { number: 12, url: 'https://github.com/o/r/pull/12', state, base: 'main' },
    },
  });

const ids = (i: IslandView, host?: GitHostView) =>
  card(i, host).actions.map((a) => [a.id, a.disabled]);

describe('PR badges (#153)', () => {
  it("shows the PR's number and state, a plain PR while one could open, and nothing without a worktree", () => {
    expect(badgeOf(withPr('changesRequested'))).toEqual({
      state: 'changesRequested',
      label: '#12 CHANGES',
      color: 0xd29922,
    });
    expect(badgeOf(island())).toMatchObject({ state: 'none', label: 'PR' });
    expect(badgeOf(island({ pullRequestDraft: null }))).toBeNull();
  });
});

describe('the PR card (#153)', () => {
  it('offers Open PR and Push branch only before there is a PR, with core’s reason when it can’t open', () => {
    expect(card(island())).toMatchObject({
      heading: 'Pull request',
      status: 'No pull request yet.',
      url: null,
      busy: null,
    });
    expect(ids(island())).toEqual([
      ['open', null],
      ['push', null],
    ]);
    const stacked = island({
      pullRequestDraft: { ...DRAFT, cannotOpen: 'Open the pull request of Backend first.' },
    });
    expect(ids(stacked)).toEqual([
      ['open', 'Open the pull request of Backend first.'],
      ['push', null],
    ]);
    expect(ids(island({ pullRequestDraft: null }))).toEqual([
      ['open', 'This island has no worktree.'],
      ['push', 'This island has no worktree.'],
    ]);
  });

  it('says what is under way and the last failure, and waits while busy', () => {
    const busy = island({
      remote: { pushedHead: 'abc', busy: 'pushing', error: null, pullRequest: null },
    });
    expect(card(busy)).toMatchObject({
      busy: 'Pushing…',
      status: 'Branch pushed; no pull request yet.',
    });
    expect(ids(busy)).toEqual([
      ['open', 'Wait for the push to finish.'],
      ['push', 'Wait for the push to finish.'],
    ]);
    const failed = island({
      remote: { pushedHead: null, busy: null, error: 'No GitHub remote.', pullRequest: null },
    });
    expect(card(failed).error).toBe('No GitHub remote.');
  });

  it('marks a draft ready only once every task is done, and links the PR', () => {
    const draft = withPr('draft');
    expect(card(draft)).toMatchObject({
      heading: 'Pull request #12',
      status: 'Draft, into main',
      url: 'https://github.com/o/r/pull/12',
    });
    expect(ids(draft)).toEqual([
      ['update', null],
      ['markReady', 'Every task on the island has to pass first.'],
      ['comments', null],
      ['refresh', null],
    ]);
    const done = {
      ...draft,
      taskPoints: draft.taskPoints.map((tp) => ({ ...tp, state: 'done' as const })),
    };
    expect(cleared(done)).toBe(true);
    expect(ids(done)).toContainEqual(['markReady', null]);
    expect(ids(withPr('approved'))).toEqual([
      ['update', null],
      ['comments', null],
      ['refresh', null],
    ]);
  });

  it('offers only Remove worktree once merged (asking to confirm), and nothing once closed (#154)', () => {
    expect(card(withPr('merged'))).toMatchObject({
      status: 'Merged, into main',
      actions: [
        {
          id: 'remove',
          label: 'Remove worktree',
          disabled: null,
          confirm: 'Remove the worktree and local branch?',
        },
      ],
    });
    expect(card({ ...withPr('merged'), worktree: 'removed' }).actions).toEqual([]);
    expect(card(withPr('closed')).actions).toEqual([]);
  });

  it('offers Restack after the island before merged, and says when the hero is resolving it (#154)', () => {
    const offered = (pullRequest: boolean, conflict = false) => {
      const base = withPr('open');
      const remote = base.remote ?? {
        pushedHead: null,
        busy: null,
        error: null,
        pullRequest: null,
      };
      return island({
        pullRequestDraft: pullRequest ? null : DRAFT,
        remote: {
          ...remote,
          pullRequest: pullRequest ? remote.pullRequest : null,
          restack: { onto: 'main', upstream: 'b-head', conflict },
        },
      });
    };
    expect(card(offered(true)).actions.at(-1)).toEqual({
      id: 'restack',
      label: 'Restack onto main',
      disabled: null,
      confirm: 'Restack and force-push?',
    });
    expect(card(offered(true)).restack).toBe(
      'The island it built on merged. Restack moves this branch onto main without the merged commits.',
    );
    // Without a PR nothing is pushed, so there's nothing to confirm.
    expect(card(offered(false)).actions.at(-1)).toEqual({
      id: 'restack',
      label: 'Restack onto main',
      disabled: null,
    });
    const conflict = card(offered(true, true));
    expect(conflict.actions.map((a) => a.id)).not.toContain('restack');
    expect(conflict.restack).toMatch(/the hero is resolving it/);
  });

  it.each([
    ['fetchingComments', 'Fetching the review comments…'],
    ['retargeting', 'Retargeting the pull request…'],
    ['restacking', 'Restacking the branch…'],
  ] as const)('says when it is %s (#154)', (busy, text) => {
    const pr = withPr('open');
    const remote = pr.remote ?? { pushedHead: null, busy: null, error: null, pullRequest: null };
    expect(card({ ...pr, remote: { ...remote, busy } }).busy).toBe(text);
  });

  it("disables what the git host doesn't allow before any click, and says when signing in will be asked (#162)", () => {
    const noOrigin = 'The repository has no origin remote.';
    expect(ids(island(), { push: noOrigin, pullRequests: noOrigin, signedIn: false })).toEqual([
      ['open', noOrigin],
      ['push', noOrigin],
    ]);
    const notGitHub = "Pull requests need a GitHub remote, and origin isn't on github.com.";
    const elsewhere = { push: null, pullRequests: notGitHub, signedIn: false };
    expect(ids(island(), elsewhere)).toEqual([
      ['open', notGitHub],
      ['push', null],
    ]);
    expect(ids(withPr('draft'), elsewhere)).toEqual([
      ['update', null],
      ['markReady', notGitHub],
      ['comments', notGitHub],
      ['refresh', notGitHub],
    ]);
    expect(card(island(), elsewhere).signIn).toBeNull();
    expect(card(island(), { push: null, pullRequests: null, signedIn: false }).signIn).toBe(
      "You'll be asked to sign in to GitHub.",
    );
    expect(card(island(), { push: null, pullRequests: null, signedIn: true }).signIn).toBeNull();
  });
});
