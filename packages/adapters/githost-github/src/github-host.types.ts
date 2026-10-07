export interface GitHubHostOptions {
  /**
   * A GitHub token with `repo` scope (VS Code's GitHub sign-in in the extension). `interactive` may
   * ask the user to sign in; polling never does. Null when the user isn't signed in.
   */
  token: (request: { interactive: boolean }) => Promise<string | null>;
  /** Injectable for tests; the global one by default. */
  fetch?: typeof fetch;
  /** `https://api.github.com` by default. */
  apiUrl?: string;
}

/** A repository on GitHub, from `origin`'s URL. */
export interface GitHubRepository {
  owner: string;
  name: string;
}

/** One PR as the polling query returns it. */
export interface PolledNode {
  number: number;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}
