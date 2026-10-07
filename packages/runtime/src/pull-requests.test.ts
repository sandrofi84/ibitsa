import type { GameMasterEvent } from '@ibitsa/core';
import type { PolledPullRequest } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Clock, GameMaster, GitHost } from './ports.types';
import { PullRequests } from './pull-requests';

class ManualClock implements Clock {
  private ms = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  now(): number {
    return this.ms;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.queue.push({ at: this.ms + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.queue = this.queue.filter((q) => q.id !== handle);
  }
  advance(ms: number): void {
    const end = this.ms + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const next = this.queue[0];
      if (!next || next.at > end) break;
      this.queue.shift();
      this.ms = next.at;
      next.fn();
    }
    this.ms = end;
  }
  get pending(): number {
    return this.queue.length;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup({
  push = async () => ({ ok: true as const, head: 'c0ffee' }),
  remoteUrl = async () => 'git@github.com:o/r.git' as string | null,
  host = {} as Partial<GitHost> | null,
  pollSeconds = 60,
  restack = async () => 'restacked' as 'restacked' | 'conflict' | 'uncommitted',
} = {}) {
  const clock = new ManualClock();
  const events: GameMasterEvent[] = [];
  const calls: string[] = [];
  const polls: PolledPullRequest[][] = [];
  const gameMaster = {
    push: async (request: { branch: string; force?: boolean }) => {
      calls.push(`push ${request.branch}${request.force ? ' (force)' : ''}`);
      return push();
    },
    restack: async (request: { onto: string; upstream: string }) => {
      calls.push(`restack onto ${request.onto} from ${request.upstream}`);
      return restack();
    },
    remoteUrl,
  } as unknown as GameMaster;
  const gitHost: GitHost | undefined = host
    ? {
        openPullRequest: async (r) => {
          calls.push(`open ${r.head} → ${r.base} on ${r.remoteUrl}${r.draft ? ' (draft)' : ''}`);
          return {
            number: 12,
            url: 'https://github.com/o/r/pull/12',
            state: r.draft ? 'draft' : 'open',
          };
        },
        status: async () => ({ unsupported: null, signedIn: true }),
        markReady: async (r) => {
          calls.push(`ready #${r.number}`);
        },
        poll: async (r) => {
          calls.push(`poll ${r.numbers.join(',')}`);
          const next = polls.shift();
          if (!next) throw new Error('offline');
          return next;
        },
        reviewComments: async (r) => {
          calls.push(`comments #${r.number}`);
          return [{ author: 'ana', body: 'Rename it' }];
        },
        retarget: async (r) => {
          calls.push(`retarget #${r.number} → ${r.base}`);
        },
        ...host,
      }
    : undefined;
  const prs = new PullRequests({
    gameMaster,
    gitHost,
    clock,
    pollSeconds: () => pollSeconds,
    report: (e) => events.push(e),
  });
  return { prs, clock, events, calls, polls };
}

const OPEN = {
  type: 'openPullRequest' as const,
  islandId: 'i2',
  worktreePath: '/wt',
  branch: 'ibitsa/sign-in',
  base: 'main',
  title: 'Sign-in',
  body: 'B',
  draft: true,
};

describe('PullRequests (#152)', () => {
  it('pushes, then opens the PR on the remote, and reports the head pushed', async () => {
    const { prs, events, calls } = setup();
    prs.perform(OPEN);
    await flush();
    expect(calls).toEqual([
      'push ibitsa/sign-in',
      'open ibitsa/sign-in → main on git@github.com:o/r.git (draft)',
    ]);
    expect(events).toEqual([
      {
        type: 'pullRequestOpened',
        islandId: 'i2',
        head: 'c0ffee',
        number: 12,
        url: 'https://github.com/o/r/pull/12',
        state: 'draft',
      },
    ]);
  });

  it('pushes, then marks the draft ready', async () => {
    const { prs, events, calls } = setup();
    prs.perform({
      type: 'markPullRequestReady',
      islandId: 'i2',
      worktreePath: '/wt',
      branch: 'b',
      number: 12,
    });
    await flush();
    expect(calls).toEqual(['push b', 'ready #12']);
    expect(events).toEqual([{ type: 'pullRequestReady', islandId: 'i2', head: 'c0ffee' }]);
  });

  it('pushes a branch without a git host at all', async () => {
    const { prs, events } = setup({ host: null });
    prs.perform({ type: 'pushBranch', islandId: 'i2', worktreePath: '/wt', branch: 'b' });
    await flush();
    expect(events).toEqual([{ type: 'branchPushed', islandId: 'i2', head: 'c0ffee' }]);
  });

  it('reports every failure as remoteFailed, in words', async () => {
    const failures = async (
      options: Parameters<typeof setup>[0],
      effect = OPEN as Parameters<PullRequests['perform']>[0],
    ) => {
      const { prs, events } = setup(options);
      prs.perform(effect);
      await flush();
      return events.map((e) => (e.type === 'remoteFailed' ? e.message : e.type));
    };
    expect(await failures({ host: null })).toEqual([
      'Pull requests need a git host; only Push branch works.',
    ]);
    expect(await failures({ remoteUrl: async () => null })).toEqual([
      'The repository has no origin remote.',
    ]);
    expect(
      await failures({
        push: async () => ({ ok: false, reason: 'rejected: non-fast-forward' }) as never,
      }),
    ).toEqual(['rejected: non-fast-forward']);
    expect(
      await failures({
        host: {
          openPullRequest: async () => {
            throw new Error('GitHub: A pull request already exists');
          },
        },
      }),
    ).toEqual(['GitHub: A pull request already exists']);
    const { prs, events } = setup();
    const noPush = new PullRequests({
      gameMaster: {} as GameMaster,
      clock: new ManualClock(),
      pollSeconds: () => 60,
      report: (e) => events.push(e),
    });
    noPush.perform({ type: 'pushBranch', islandId: 'i2', worktreePath: '/wt', branch: 'b' });
    await flush();
    expect(events).toEqual([
      { type: 'remoteFailed', islandId: 'i2', message: 'This game master cannot push.' },
    ]);
    prs.dispose();
  });

  it('polls the watched PRs at the interval and reports only what changed', async () => {
    const { prs, clock, events, calls, polls } = setup();
    prs.perform({ type: 'watchPullRequests', numbers: [12, 13] });
    expect(clock.pending).toBe(1);
    polls.push(
      [
        { number: 12, state: 'open' },
        { number: 13, state: 'draft' },
      ],
      [
        { number: 12, state: 'open' },
        { number: 13, state: 'draft' },
      ],
      [
        { number: 12, state: 'approved' },
        { number: 13, state: 'draft' },
      ],
    );
    clock.advance(60_000);
    await flush();
    clock.advance(60_000);
    await flush();
    clock.advance(60_000);
    await flush();
    expect(calls).toEqual(['poll 12,13', 'poll 12,13', 'poll 12,13']);
    expect(events).toEqual([
      {
        type: 'pullRequestsPolled',
        pullRequests: [
          { number: 12, state: 'open' },
          { number: 13, state: 'draft' },
        ],
      },
      { type: 'pullRequestsPolled', pullRequests: [{ number: 12, state: 'approved' }] },
    ]);

    // A failed poll (offline) waits for the next one.
    clock.advance(60_000);
    await flush();
    expect(events).toHaveLength(2);
    expect(clock.pending).toBe(1);

    prs.perform({ type: 'watchPullRequests', numbers: [] });
    expect(clock.pending).toBe(0);
  });

  it('polls now on refresh, and never more often than every 15 s', async () => {
    const { prs, clock, calls, polls } = setup({ pollSeconds: 1 });
    polls.push([{ number: 12, state: 'open' }]);
    prs.perform({ type: 'pollPullRequests', numbers: [12] });
    await flush();
    expect(calls).toEqual(['poll 12']);
    prs.perform({ type: 'pollPullRequests', numbers: [] });
    prs.perform({ type: 'watchPullRequests', numbers: [12] });
    clock.advance(14_000);
    await flush();
    expect(calls).toHaveLength(1);
    clock.advance(1_000);
    await flush();
    expect(calls).toHaveLength(2);
    prs.dispose();
    expect(clock.pending).toBe(0);
  });

  it("doesn't poll without a git host or a remote", async () => {
    for (const options of [{ host: null }, { remoteUrl: async () => null }]) {
      const { prs, calls, events } = setup(options);
      prs.perform({ type: 'pollPullRequests', numbers: [12] });
      await flush();
      expect(calls).toEqual([]);
      expect(events).toEqual([]);
    }
  });

  it('fetches review comments and retargets a PR (#154)', async () => {
    const { prs, events, calls } = setup();
    prs.perform({ type: 'fetchPullRequestComments', islandId: 'i2', number: 12 });
    prs.perform({ type: 'retargetPullRequest', islandId: 'i3', number: 13, base: 'main' });
    await flush();
    expect(calls).toEqual(['comments #12', 'retarget #13 → main']);
    expect(events).toEqual([
      {
        type: 'pullRequestComments',
        islandId: 'i2',
        comments: [{ author: 'ana', body: 'Rename it' }],
      },
      { type: 'pullRequestRetargeted', islandId: 'i3', base: 'main' },
    ]);
  });

  const RESTACK = {
    type: 'restack' as const,
    islandId: 'i3',
    worktreePath: '/wt3',
    branch: 'ibitsa/front',
    onto: 'main',
    upstream: 'b-head',
    push: true,
  };

  it('restacks and force-pushes a branch with a PR; without one it only moves it (#154)', async () => {
    const withPr = setup();
    withPr.prs.perform(RESTACK);
    await flush();
    expect(withPr.calls).toEqual(['restack onto main from b-head', 'push ibitsa/front (force)']);
    expect(withPr.events).toEqual([
      { type: 'restacked', islandId: 'i3', outcome: 'restacked', head: 'c0ffee' },
    ]);
    const local = setup();
    local.prs.perform({ ...RESTACK, push: false });
    await flush();
    expect(local.calls).toEqual(['restack onto main from b-head']);
    expect(local.events).toEqual([
      { type: 'restacked', islandId: 'i3', outcome: 'restacked', head: null },
    ]);
  });

  it("reports a conflict without pushing, and won't restack uncommitted work (#154)", async () => {
    const conflict = setup({ restack: async () => 'conflict' as const });
    conflict.prs.perform(RESTACK);
    await flush();
    expect(conflict.calls).toEqual(['restack onto main from b-head']);
    expect(conflict.events).toEqual([
      { type: 'restacked', islandId: 'i3', outcome: 'conflict', head: null },
    ]);
    const dirty = setup({ restack: async () => 'uncommitted' as const });
    dirty.prs.perform(RESTACK);
    await flush();
    expect(dirty.events).toEqual([
      {
        type: 'remoteFailed',
        islandId: 'i3',
        message: 'The worktree has uncommitted changes: commit or discard them first.',
      },
    ]);
    const events: GameMasterEvent[] = [];
    new PullRequests({
      gameMaster: {} as GameMaster,
      clock: new ManualClock(),
      pollSeconds: () => 60,
      report: (e) => events.push(e),
    }).perform(RESTACK);
    await flush();
    expect(events).toEqual([
      { type: 'remoteFailed', islandId: 'i3', message: 'This game master cannot restack.' },
    ]);
  });

  it('says what stands in the way before any click (#162)', async () => {
    expect(await setup().prs.status()).toEqual({ push: null, pullRequests: null, signedIn: true });
    expect(await setup({ remoteUrl: async () => null }).prs.status()).toEqual({
      push: 'The repository has no origin remote.',
      pullRequests: 'The repository has no origin remote.',
      signedIn: false,
    });
    expect(await setup({ host: null }).prs.status()).toEqual({
      push: null,
      pullRequests: 'Pull requests need a git host; only Push branch works.',
      signedIn: false,
    });
    const gitlab = setup({
      host: { status: async () => ({ unsupported: 'Not on GitHub.', signedIn: false }) },
    });
    expect(await gitlab.prs.status()).toEqual({
      push: null,
      pullRequests: 'Not on GitHub.',
      signedIn: false,
    });
  });
});
