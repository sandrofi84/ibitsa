import type { IslandView, PullRequestDraft, PullRequestState } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { badgeOf, cardOf, cleared } from './pull-requests';

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

const ids = (i: IslandView) => cardOf(i).actions.map((a) => [a.id, a.disabled]);

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
    expect(cardOf(island())).toMatchObject({
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
    expect(cardOf(busy)).toMatchObject({
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
    expect(cardOf(failed).error).toBe('No GitHub remote.');
  });

  it('marks a draft ready only once every task is done, and links the PR', () => {
    const draft = withPr('draft');
    expect(cardOf(draft)).toMatchObject({
      heading: 'Pull request #12',
      status: 'Draft, into main',
      url: 'https://github.com/o/r/pull/12',
    });
    expect(ids(draft)).toEqual([
      ['update', null],
      ['markReady', 'Every task on the island has to pass first.'],
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
      ['refresh', null],
    ]);
  });

  it('has nothing left to do once the PR is merged or closed', () => {
    expect(cardOf(withPr('merged'))).toMatchObject({ status: 'Merged, into main', actions: [] });
    expect(cardOf(withPr('closed')).actions).toEqual([]);
  });
});
