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
} = {}) {
  const clock = new ManualClock();
  const events: GameMasterEvent[] = [];
  const calls: string[] = [];
  const polls: PolledPullRequest[][] = [];
  const gameMaster = {
    push: async (request: { branch: string }) => {
      calls.push(`push ${request.branch}`);
      return push();
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
        markReady: async (r) => {
          calls.push(`ready #${r.number}`);
        },
        poll: async (r) => {
          calls.push(`poll ${r.numbers.join(',')}`);
          const next = polls.shift();
          if (!next) throw new Error('offline');
          return next;
        },
        reviewComments: async () => [],
        retarget: async () => {},
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
});
