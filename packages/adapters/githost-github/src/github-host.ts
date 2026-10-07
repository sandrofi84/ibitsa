import type { PolledPullRequest, PullRequestState } from '@ibitsa/protocol';
import type { GitHost, PullRequestComment } from '@ibitsa/runtime';
import type { GitHubHostOptions, GitHubRepository, PolledNode } from './github-host.types';

const API_VERSION = '2022-11-28';
/** Check rollups that mean the PR's checks are failing. */
const FAILING = new Set(['FAILURE', 'ERROR']);

/**
 * GitHub as Ibitsa's git host (spec §5.6, M6): opens PRs, marks drafts ready, polls their badges in
 * one GraphQL query, reads review comments and retargets a PR. The token comes from the extension
 * (VS Code's GitHub sign-in) on each call and is never stored or logged here.
 */
export class GitHubHost implements GitHost {
  private readonly options: GitHubHostOptions;

  constructor(options: GitHubHostOptions) {
    this.options = options;
  }

  /** The repository `origin` points to: HTTPS, SSH or `git@` URLs on github.com; null otherwise. */
  static repository(remoteUrl: string): GitHubRepository | null {
    const match = remoteUrl
      .trim()
      .match(
        /^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
      );
    return match?.[1] && match[2] ? { owner: match[1], name: match[2] } : null;
  }

  /** The badge for a polled PR: merged and closed first, then draft, then what blocks merging. */
  static badge(node: PolledNode): PullRequestState {
    if (node.state === 'MERGED') return 'merged';
    if (node.state === 'CLOSED') return 'closed';
    if (node.isDraft) return 'draft';
    if (node.reviewDecision === 'CHANGES_REQUESTED') return 'changesRequested';
    const rollup = node.commits.nodes[0]?.commit.statusCheckRollup?.state;
    if (rollup && FAILING.has(rollup)) return 'checksFailing';
    return node.reviewDecision === 'APPROVED' ? 'approved' : 'open';
  }

  async openPullRequest({
    remoteUrl,
    head,
    base,
    title,
    body,
    draft,
  }: {
    remoteUrl: string;
    head: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string; state: PullRequestState }> {
    const repo = this.repo(remoteUrl);
    const created = (await this.rest({
      method: 'POST',
      path: `/repos/${repo.owner}/${repo.name}/pulls`,
      body: { title, head, base, body, draft },
    })) as { number: number; html_url: string; draft?: boolean };
    return {
      number: created.number,
      url: created.html_url,
      state: created.draft ? 'draft' : 'open',
    };
  }

  async markReady({ remoteUrl, number }: { remoteUrl: string; number: number }): Promise<void> {
    const repo = this.repo(remoteUrl);
    const pr = (await this.rest({
      method: 'GET',
      path: `/repos/${repo.owner}/${repo.name}/pulls/${number}`,
    })) as { node_id: string };
    await this.graphql({
      query:
        'mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }',
      variables: { id: pr.node_id },
      interactive: true,
    });
  }

  async poll({
    remoteUrl,
    numbers,
  }: {
    remoteUrl: string;
    numbers: number[];
  }): Promise<PolledPullRequest[]> {
    if (numbers.length === 0) return [];
    const repo = this.repo(remoteUrl);
    const fields =
      'number state isDraft reviewDecision commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }';
    const prs = numbers.map((n) => `pr${n}: pullRequest(number: ${n}) { ${fields} }`).join(' ');
    const data = (await this.graphql({
      query: `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${prs} } }`,
      variables: { owner: repo.owner, name: repo.name },
      interactive: false,
    })) as { repository: Record<string, PolledNode | null> };
    return Object.values(data.repository).flatMap((node) =>
      node ? [{ number: node.number, state: GitHubHost.badge(node) }] : [],
    );
  }

  /** The review summaries and the comments left on lines, oldest first. */
  async reviewComments({
    remoteUrl,
    number,
  }: {
    remoteUrl: string;
    number: number;
  }): Promise<PullRequestComment[]> {
    const repo = this.repo(remoteUrl);
    const base = `/repos/${repo.owner}/${repo.name}/pulls/${number}`;
    type Review = { user: { login: string } | null; body: string; submitted_at?: string };
    type LineComment = Review & { path: string; line: number | null; created_at: string };
    const reviews = (await this.rest({
      method: 'GET',
      path: `${base}/reviews?per_page=100`,
    })) as Review[];
    const lines = (await this.rest({
      method: 'GET',
      path: `${base}/comments?per_page=100`,
    })) as LineComment[];
    const summaries = reviews
      .filter((r) => r.body.trim() !== '')
      .map((r) => ({
        at: r.submitted_at ?? '',
        comment: { author: r.user?.login ?? 'someone', body: r.body },
      }));
    const onLines = lines.map((c) => ({
      at: c.created_at,
      comment: {
        author: c.user?.login ?? 'someone',
        body: c.body,
        path: c.path,
        ...(c.line === null ? {} : { line: c.line }),
      },
    }));
    return [...summaries, ...onLines]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ comment }) => comment);
  }

  async retarget({
    remoteUrl,
    number,
    base,
  }: {
    remoteUrl: string;
    number: number;
    base: string;
  }): Promise<void> {
    const repo = this.repo(remoteUrl);
    await this.rest({
      method: 'PATCH',
      path: `/repos/${repo.owner}/${repo.name}/pulls/${number}`,
      body: { base },
    });
  }

  private repo(remoteUrl: string): GitHubRepository {
    const repo = GitHubHost.repository(remoteUrl);
    // The URL itself isn't repeated: an HTTPS remote can carry a token.
    if (!repo)
      throw new Error("Pull requests need a GitHub remote, and origin isn't on github.com.");
    return repo;
  }

  private async rest({
    method,
    path,
    body,
  }: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<unknown> {
    const response = await this.send({
      url: `${this.apiUrl()}${path}`,
      init: {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      interactive: method !== 'GET',
    });
    return response.json();
  }

  private async graphql({
    query,
    variables,
    interactive,
  }: {
    query: string;
    variables: Record<string, unknown>;
    interactive: boolean;
  }): Promise<unknown> {
    const response = await this.send({
      url: `${this.apiUrl()}/graphql`,
      init: { method: 'POST', body: JSON.stringify({ query, variables }) },
      interactive,
    });
    const result = (await response.json()) as { data?: unknown; errors?: { message: string }[] };
    if (result.errors?.length)
      throw new Error(`GitHub: ${result.errors.map((e) => e.message).join('; ')}`);
    return result.data;
  }

  /** One request with the token; a failure becomes a message the user can act on. */
  private async send({
    url,
    init,
    interactive,
  }: {
    url: string;
    init: RequestInit;
    interactive: boolean;
  }): Promise<Response> {
    const token = await this.options.token({ interactive });
    if (!token) throw new Error('Sign in to GitHub to work with pull requests.');
    const response = await (this.options.fetch ?? fetch)(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'ibitsa',
        'X-GitHub-Api-Version': API_VERSION,
      },
    });
    if (response.ok) return response;
    throw new Error(await failure(response));
  }

  private apiUrl(): string {
    return this.options.apiUrl ?? 'https://api.github.com';
  }
}

/** What went wrong, in words: sign-in, access, or GitHub's own message (e.g. a PR already exists). */
async function failure(response: Response): Promise<string> {
  if (response.status === 401) return 'GitHub refused the sign-in. Sign in to GitHub again.';
  if (response.status === 403 || response.status === 404) {
    return "GitHub can't find the repository, or this account can't change it.";
  }
  const body = (await response.json().catch(() => ({}))) as {
    message?: string;
    errors?: { message?: string }[];
  };
  const details = (body.errors ?? []).flatMap((e) => (e.message ? [e.message] : []));
  return `GitHub: ${details.length > 0 ? details.join('; ') : (body.message ?? response.statusText)}`;
}
