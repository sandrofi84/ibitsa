import { describe, expect, it } from 'vitest';
import { GitHubHost } from './github-host';
import type { PolledNode } from './github-host.types';

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** A fake GitHub: answers each request with the next reply, and records what was asked. */
function github(...replies: { status?: number; json: unknown }[]) {
  const calls: Call[] = [];
  const asks: boolean[] = [];
  const host = new GitHubHost({
    token: async ({ interactive }) => {
      asks.push(interactive);
      return 'gho_secret';
    },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? 'GET',
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: init.headers as Record<string, string>,
      });
      const reply = replies.shift() ?? { json: {} };
      const status = reply.status ?? 200;
      return {
        ok: status < 300,
        status,
        statusText: 'Unprocessable',
        json: async () => reply.json,
      } as Response;
    }) as typeof fetch,
  });
  return { host, calls, asks };
}

const REMOTE = 'git@github.com:sandrofi84/ibitsa-sandbox.git';
const node = (extra: Partial<PolledNode>): PolledNode => ({
  number: 1,
  state: 'OPEN',
  isDraft: false,
  reviewDecision: null,
  commits: { nodes: [] },
  ...extra,
});

describe('GitHubHost (#152)', () => {
  it.each([
    ['git@github.com:o/r.git', { owner: 'o', name: 'r' }],
    ['https://github.com/o/r', { owner: 'o', name: 'r' }],
    ['https://x-access-token:abc@github.com/o/r.git', { owner: 'o', name: 'r' }],
    ['ssh://git@github.com/o/r.git/', { owner: 'o', name: 'r' }],
    ['https://gitlab.com/o/r.git', null],
    ['https://github.com/o', null],
  ])('reads the repository from %s', (url, repo) => {
    expect(GitHubHost.repository(url)).toEqual(repo);
  });

  it.each([
    [node({ state: 'MERGED', isDraft: true }), 'merged'],
    [node({ state: 'CLOSED' }), 'closed'],
    [node({ isDraft: true, reviewDecision: 'APPROVED' }), 'draft'],
    [node({ reviewDecision: 'CHANGES_REQUESTED' }), 'changesRequested'],
    [
      node({
        reviewDecision: 'APPROVED',
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
      }),
      'checksFailing',
    ],
    [node({ reviewDecision: 'APPROVED' }), 'approved'],
    [
      node({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] } }),
      'open',
    ],
  ])('turns a polled PR into its badge (%#)', (polled, badge) => {
    expect(GitHubHost.badge(polled)).toBe(badge);
  });

  it('opens a PR with the token, asking the user to sign in if need be', async () => {
    const { host, calls, asks } = github({
      status: 201,
      json: { number: 12, html_url: 'https://github.com/o/r/pull/12', draft: true },
    });
    const opened = await host.openPullRequest({
      remoteUrl: REMOTE,
      head: 'ibitsa/sign-in',
      base: 'main',
      title: 'Sign-in',
      body: 'Body',
      draft: true,
    });
    expect(opened).toEqual({ number: 12, url: 'https://github.com/o/r/pull/12', state: 'draft' });
    expect(calls[0]).toMatchObject({
      url: 'https://api.github.com/repos/sandrofi84/ibitsa-sandbox/pulls',
      method: 'POST',
      body: { title: 'Sign-in', head: 'ibitsa/sign-in', base: 'main', body: 'Body', draft: true },
      headers: { Authorization: 'Bearer gho_secret', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    expect(asks).toEqual([true]);
  });

  it('marks a draft ready through its node id', async () => {
    const { host, calls } = github(
      { json: { node_id: 'PR_kw1' } },
      { json: { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } } },
    );
    await host.markReady({ remoteUrl: REMOTE, number: 12 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.github.com/repos/sandrofi84/ibitsa-sandbox/pulls/12',
      'POST https://api.github.com/graphql',
    ]);
    expect(calls[1]?.body).toMatchObject({ variables: { id: 'PR_kw1' } });
  });

  it('polls every PR in one query, without asking the user to sign in', async () => {
    const { host, calls, asks } = github({
      json: {
        data: {
          repository: {
            pr12: node({ number: 12, reviewDecision: 'APPROVED' }),
            pr13: node({ number: 13, state: 'MERGED' }),
            pr14: null,
          },
        },
      },
    });
    expect(await host.poll({ remoteUrl: REMOTE, numbers: [12, 13, 14] })).toEqual([
      { number: 12, state: 'approved' },
      { number: 13, state: 'merged' },
    ]);
    const query = (calls[0]?.body as { query?: string } | undefined)?.query ?? '';
    expect(query).toContain('pr12: pullRequest(number: 12)');
    expect(query).toContain('pr14: pullRequest(number: 14)');
    expect(calls[0]?.body).toMatchObject({
      variables: { owner: 'sandrofi84', name: 'ibitsa-sandbox' },
    });
    expect(asks).toEqual([false]);
    expect(await host.poll({ remoteUrl: REMOTE, numbers: [] })).toEqual([]);
  });

  it('reads review summaries and line comments, oldest first', async () => {
    const { host } = github(
      {
        json: [
          {
            user: { login: 'ana' },
            body: 'Please rename it',
            submitted_at: '2026-10-07T10:05:00Z',
          },
          { user: { login: 'bo' }, body: '  ', submitted_at: '2026-10-07T10:06:00Z' },
        ],
      },
      {
        json: [
          {
            user: null,
            body: 'Off by one',
            path: 'src/a.ts',
            line: 4,
            created_at: '2026-10-07T10:01:00Z',
          },
          {
            user: { login: 'ana' },
            body: 'Outdated',
            path: 'src/b.ts',
            line: null,
            created_at: '2026-10-07T10:09:00Z',
          },
        ],
      },
    );
    expect(await host.reviewComments({ remoteUrl: REMOTE, number: 12 })).toEqual([
      { author: 'someone', body: 'Off by one', path: 'src/a.ts', line: 4 },
      { author: 'ana', body: 'Please rename it' },
      { author: 'ana', body: 'Outdated', path: 'src/b.ts' },
    ]);
  });

  it('retargets a PR onto a new base', async () => {
    const { host, calls } = github({ json: {} });
    await host.retarget({ remoteUrl: REMOTE, number: 13, base: 'main' });
    expect(calls[0]).toMatchObject({
      method: 'PATCH',
      url: 'https://api.github.com/repos/sandrofi84/ibitsa-sandbox/pulls/13',
      body: { base: 'main' },
    });
  });

  it('says what went wrong in words the user can act on', async () => {
    const open = (host: GitHubHost, remoteUrl = REMOTE) =>
      host.openPullRequest({
        remoteUrl,
        head: 'h',
        base: 'main',
        title: 'T',
        body: '',
        draft: false,
      });
    await expect(open(github().host, 'https://bitbucket.org/o/r.git')).rejects.toThrow(
      "Pull requests need a GitHub remote, and origin isn't on github.com.",
    );
    await expect(open(github({ status: 401, json: {} }).host)).rejects.toThrow(
      'GitHub refused the sign-in. Sign in to GitHub again.',
    );
    await expect(open(github({ status: 404, json: {} }).host)).rejects.toThrow(
      "GitHub can't find the repository, or this account can't change it.",
    );
    await expect(
      open(
        github({
          status: 422,
          json: {
            message: 'Validation Failed',
            errors: [{ message: 'A pull request already exists for o:h.' }],
          },
        }).host,
      ),
    ).rejects.toThrow('GitHub: A pull request already exists for o:h.');
    await expect(
      open(github({ status: 422, json: { message: 'Validation Failed' } }).host),
    ).rejects.toThrow('GitHub: Validation Failed');
    const { host } = github({ json: { errors: [{ message: 'Could not resolve' }] } });
    await expect(host.poll({ remoteUrl: REMOTE, numbers: [1] })).rejects.toThrow(
      'GitHub: Could not resolve',
    );
    const signedOut = new GitHubHost({ token: async () => null });
    await expect(open(signedOut)).rejects.toThrow('Sign in to GitHub to work with pull requests.');
  });
});
