import type { Effect } from '@ibitsa/core';
import type { PullRequestState } from '@ibitsa/protocol';
import type { FakeGitHubOptions } from './fake-github.types';

const PACE_MS = 600;
/** What a PR ready for review becomes at each poll: approved, then merged by someone on GitHub. */
const NEXT: Partial<Record<PullRequestState, PullRequestState>> = {
  open: 'approved',
  approved: 'merged',
};

/**
 * Dev only (#153): GitHub for the live host. It answers pushes, opened PRs and drafts marked ready as
 * the runtime would (#152), and each poll moves a PR ready for review one step along open → approved →
 * merged, so a campaign can be played to Ibitsa. With `pr=demo` it polls on a timer; otherwise only on
 * Refresh. A draft stays a draft until it's marked ready.
 */
export class FakeGitHub {
  private readonly input: FakeGitHubOptions['input'];
  private readonly t: () => number;
  private readonly pollMs: number | null;
  private readonly pace: number;
  private readonly states = new Map<number, PullRequestState>();
  private next = 1;
  private pushes = 0;
  private watched: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor({ input, t, pollMs = null, pace = PACE_MS }: FakeGitHubOptions) {
    this.input = input;
    this.t = t;
    this.pollMs = pollMs;
    this.pace = pace;
  }

  /** Answers a push or PR effect; false when it isn't one. */
  perform(effect: Effect): boolean {
    switch (effect.type) {
      case 'pushBranch':
        this.later({ type: 'branchPushed', islandId: effect.islandId, head: this.head() });
        return true;
      case 'openPullRequest': {
        const number = this.next++;
        const state = effect.draft ? 'draft' : 'open';
        this.states.set(number, state);
        this.later({
          type: 'pullRequestOpened',
          islandId: effect.islandId,
          head: this.head(),
          number,
          url: `https://github.com/ibitsa/demo/pull/${number}`,
          state,
        });
        return true;
      }
      case 'markPullRequestReady':
        this.states.set(effect.number, 'open');
        this.later({ type: 'pullRequestReady', islandId: effect.islandId, head: this.head() });
        return true;
      case 'watchPullRequests':
        this.watch(effect.numbers);
        return true;
      case 'pollPullRequests':
        this.poll(effect.numbers);
        return true;
      default:
        return false;
    }
  }

  private watch(numbers: number[]): void {
    this.watched = numbers;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.pollMs !== null && numbers.length > 0) {
      this.timer = setInterval(() => this.poll(this.watched), this.pollMs);
    }
  }

  private poll(numbers: number[]): void {
    const pullRequests = numbers.flatMap((number) => {
      const state = this.states.get(number);
      if (!state) return [];
      const next = NEXT[state] ?? state;
      this.states.set(number, next);
      return [{ number, state: next }];
    });
    this.later({ type: 'pullRequestsPolled', pullRequests });
  }

  private head(): string {
    return `pushed-${++this.pushes}`;
  }

  private later(
    event: Extract<Parameters<FakeGitHubOptions['input']>[0], { kind: 'gm' }>['event'],
  ) {
    setTimeout(() => this.input({ kind: 'gm', t: this.t(), event }), this.pace);
  }
}
