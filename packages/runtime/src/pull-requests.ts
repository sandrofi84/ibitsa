import type { GitHostView, PullRequestState } from '@ibitsa/protocol';
import type { PullRequestEffect, PullRequestsOptions } from './pull-requests.types';

const NO_HOST = 'Pull requests need a git host; only Push branch works.';
/** Polling never runs more often than this, whatever the setting says. */
const MIN_POLL_SECONDS = 15;

/**
 * Pushes and pull requests (spec §5.6, M6): carries out core's PR effects with the git game master
 * and the git host, and polls the PRs core watches. Only a poll that changed something is reported,
 * so the event log doesn't grow by a line a minute while nothing happens.
 */
export class PullRequests {
  private readonly options: PullRequestsOptions;
  private watched: number[] = [];
  /** The state each watched PR had at the last poll. */
  private readonly last = new Map<number, PullRequestState>();
  private timer: unknown = null;
  private polling = false;

  constructor(options: PullRequestsOptions) {
    this.options = options;
  }

  perform(effect: PullRequestEffect): void {
    switch (effect.type) {
      case 'pushBranch':
        void this.attempt({ islandId: effect.islandId, work: () => this.pushOnly(effect) });
        return;
      case 'openPullRequest':
        void this.attempt({ islandId: effect.islandId, work: () => this.open(effect) });
        return;
      case 'markPullRequestReady':
        void this.attempt({ islandId: effect.islandId, work: () => this.markReady(effect) });
        return;
      case 'watchPullRequests':
        this.watch(effect.numbers);
        return;
      case 'pollPullRequests':
        void this.poll(effect.numbers);
        return;
      case 'fetchPullRequestComments':
        void this.attempt({ islandId: effect.islandId, work: () => this.comments(effect) });
        return;
      case 'retargetPullRequest':
        void this.attempt({ islandId: effect.islandId, work: () => this.retarget(effect) });
        return;
      case 'restack':
        void this.attempt({ islandId: effect.islandId, work: () => this.restack(effect) });
        return;
    }
  }

  private async comments(effect: Extract<PullRequestEffect, { type: 'fetchPullRequestComments' }>) {
    const { host, remoteUrl } = await this.host();
    const comments = await host.reviewComments({ remoteUrl, number: effect.number });
    this.options.report({ type: 'pullRequestComments', islandId: effect.islandId, comments });
  }

  private async retarget(effect: Extract<PullRequestEffect, { type: 'retargetPullRequest' }>) {
    const { host, remoteUrl } = await this.host();
    await host.retarget({ remoteUrl, number: effect.number, base: effect.base });
    this.options.report({
      type: 'pullRequestRetargeted',
      islandId: effect.islandId,
      base: effect.base,
    });
  }

  /** Moves the branch onto the merged island's base, then (with a PR) pushes it, forced with lease. */
  private async restack(effect: Extract<PullRequestEffect, { type: 'restack' }>) {
    const restack = this.options.gameMaster.restack?.bind(this.options.gameMaster);
    if (!restack) throw new Error('This game master cannot restack.');
    const outcome = await restack({
      worktreePath: effect.worktreePath,
      onto: effect.onto,
      upstream: effect.upstream,
    });
    if (outcome === 'uncommitted') {
      throw new Error('The worktree has uncommitted changes: commit or discard them first.');
    }
    const head =
      outcome === 'restacked' && effect.push ? await this.push({ ...effect, force: true }) : null;
    this.options.report({ type: 'restacked', islandId: effect.islandId, outcome, head });
  }

  /**
   * What stands in the way here (#162): no origin stops everything; a remote the host doesn't serve,
   * or no host at all, stops only PRs. Signing in is never asked for here.
   */
  async status(): Promise<GitHostView> {
    const remoteUrl = await this.options.gameMaster.remoteUrl?.();
    if (!remoteUrl) {
      const why = 'The repository has no origin remote.';
      return { push: why, pullRequests: why, signedIn: false };
    }
    const host = this.options.gitHost;
    if (!host) return { push: null, pullRequests: NO_HOST, signedIn: false };
    const { unsupported, signedIn } = await host.status({ remoteUrl });
    return { push: null, pullRequests: unsupported, signedIn };
  }

  dispose(): void {
    this.stopTimer();
    this.watched = [];
  }

  private async pushOnly(effect: Extract<PullRequestEffect, { type: 'pushBranch' }>) {
    const head = await this.push(effect);
    this.options.report({ type: 'branchPushed', islandId: effect.islandId, head });
  }

  private async open(effect: Extract<PullRequestEffect, { type: 'openPullRequest' }>) {
    const { host, remoteUrl } = await this.host();
    const head = await this.push(effect);
    const opened = await host.openPullRequest({
      remoteUrl,
      head: effect.branch,
      base: effect.base,
      title: effect.title,
      body: effect.body,
      draft: effect.draft,
    });
    this.options.report({ type: 'pullRequestOpened', islandId: effect.islandId, head, ...opened });
  }

  private async markReady(effect: Extract<PullRequestEffect, { type: 'markPullRequestReady' }>) {
    const { host, remoteUrl } = await this.host();
    const head = await this.push(effect);
    await host.markReady({ remoteUrl, number: effect.number });
    this.options.report({ type: 'pullRequestReady', islandId: effect.islandId, head });
  }

  /** Runs one push or PR action; whatever goes wrong comes back to core as `remoteFailed`. */
  private async attempt({ islandId, work }: { islandId: string; work: () => Promise<void> }) {
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.report({ type: 'remoteFailed', islandId, message });
    }
  }

  private async push({
    worktreePath,
    branch,
    force = false,
  }: {
    worktreePath: string;
    branch: string;
    force?: boolean | undefined;
  }) {
    const push = this.options.gameMaster.push?.bind(this.options.gameMaster);
    if (!push) throw new Error('This game master cannot push.');
    const pushed = await push({ worktreePath, branch, force });
    if (!pushed.ok) throw new Error(pushed.reason);
    return pushed.head;
  }

  private async host() {
    const host = this.options.gitHost;
    if (!host) throw new Error(NO_HOST);
    const remoteUrl = await this.options.gameMaster.remoteUrl?.();
    if (!remoteUrl) throw new Error('The repository has no origin remote.');
    return { host, remoteUrl };
  }

  private watch(numbers: number[]): void {
    this.watched = numbers;
    for (const n of this.last.keys()) if (!numbers.includes(n)) this.last.delete(n);
    if (numbers.length === 0) this.stopTimer();
    else if (this.timer === null) this.schedule();
  }

  private schedule(): void {
    const seconds = Math.max(MIN_POLL_SECONDS, this.options.pollSeconds());
    this.timer = this.options.clock.setTimeout(() => {
      this.timer = null;
      void this.poll(this.watched).finally(() => {
        if (this.watched.length > 0 && this.timer === null) this.schedule();
      });
    }, seconds * 1000);
  }

  private stopTimer(): void {
    if (this.timer !== null) this.options.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  /** Asks the host for these PRs and reports the ones whose state changed. A failed poll waits for the next. */
  private async poll(numbers: number[]): Promise<void> {
    if (this.polling || numbers.length === 0 || !this.options.gitHost) return;
    this.polling = true;
    try {
      const remoteUrl = await this.options.gameMaster.remoteUrl?.();
      if (!remoteUrl) return;
      const polled = await this.options.gitHost.poll({ remoteUrl, numbers });
      const changed = polled.filter((pr) => this.last.get(pr.number) !== pr.state);
      for (const pr of polled)
        if (this.watched.includes(pr.number)) this.last.set(pr.number, pr.state);
      if (changed.length > 0)
        this.options.report({ type: 'pullRequestsPolled', pullRequests: changed });
    } catch {
      // Offline, or signed out: the badge keeps its last state and the next poll tries again.
    } finally {
      this.polling = false;
    }
  }
}
