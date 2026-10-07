import type { Command, PolledPullRequest, PullRequestDraft } from '@ibitsa/protocol';
import { Campaign } from './campaign';
import { Hero } from './hero';
import type { GameMasterEvent } from './inputs.types';
import { Sitting } from './sitting';
import type { CoreState, Island, IslandRemote } from './state.types';
import type { StepContext } from './step.types';

/** States the git host won't change any more: nothing to poll, push or mark ready. */
const SETTLED = new Set(['merged', 'closed']);

/**
 * An island's branch on the git host and its pull request (spec §5.6, M6). Every push and PR change is
 * the user's click; core checks the rules (drafts until the island is cleared, stacked PRs in order),
 * builds the body from the record and asks the runtime to do the rest. It also keeps the runtime
 * polling exactly the PRs still open, and ends the hero's session once its PR is ready for review.
 */
export class PullRequest {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** What the preview form starts from: until the island has a PR, and once it has a worktree. */
  static draft({ state, island }: { state: CoreState; island: Island }): PullRequestDraft | null {
    if (island.remote?.pullRequest || island.worktreeRemoved || !island.worktreePath) return null;
    const cleared = Campaign.cleared(island);
    return {
      title: island.name,
      body: PullRequest.body({ state, island }),
      base: PullRequest.base({ state, island }),
      draft: !cleared,
      cleared,
      cannotOpen: PullRequest.blocked({ state, island }),
    };
  }

  /** Every island's PR is merged: the campaign's work is shipped. */
  static shipped(state: CoreState): boolean {
    return (
      state.islands.length > 0 &&
      state.islands.every((i) => i.remote?.pullRequest?.state === 'merged')
    );
  }

  /**
   * The PR body, from the record and with no tokens: the plan's summary, the island's tasks, the
   * criteria they were reviewed against, the decisions they follow, the suggestions kept for the PR,
   * the checks and the review rounds. A quick quest has its task and checks.
   */
  static body({ state, island }: { state: CoreState; island: Island }): string {
    const plan = Sitting.approvedPlan(state);
    const planTasks = island.taskPoints.flatMap((tp) => {
      const task = plan?.tasks.find((t) => t.id === tp.planTaskId);
      return task ? [task] : [];
    });
    const parts: string[] = [];
    if (plan) {
      parts.push(plan.summary);
      parts.push(
        section(
          'Tasks',
          island.taskPoints.map((tp) => {
            const ticked = tp.state === 'done' || tp.state === 'doneUnreviewed' ? 'x' : ' ';
            return `- [${ticked}] ${tp.title}`;
          }),
        ),
      );
    } else {
      // A quick quest: its task as the user wrote it, without the first line the title repeats.
      for (const tp of island.taskPoints) {
        const [first = '', ...rest] = tp.description.split('\n');
        parts.push((first.trim() === tp.title ? rest.join('\n') : tp.description).trim());
      }
    }
    parts.push(
      section(
        'Acceptance criteria',
        planTasks.flatMap((t) =>
          t.criteria.flatMap((c) => [
            `- **${t.title}**, reviewed by ${c.councillorId}:`,
            ...c.items.map((item) => `  - ${item}`),
          ]),
        ),
      ),
    );
    const decisionIds = new Set(planTasks.flatMap((t) => t.decisions));
    parts.push(
      section(
        'Decisions',
        (plan?.decisions ?? [])
          .filter((d) => decisionIds.has(d.id))
          .map((d) => `- **${d.id} ${d.title}:** ${d.chosen}. ${d.why}`),
      ),
    );
    const reviews = island.taskPoints.flatMap((tp) =>
      tp.review ? [{ tp, review: tp.review }] : [],
    );
    parts.push(
      section(
        'Kept for this pull request',
        reviews.flatMap(({ review }) =>
          review.suggestions.map((f) => {
            const where = f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ''}\`)` : '';
            return `- ${f.councillorId}${where}: ${f.message}`;
          }),
        ),
      ),
    );
    parts.push(
      section(
        'Checks',
        (reviews.at(-1)?.review.checks ?? []).map(
          (c) => `- \`${c.command}\`: ${c.ok ? 'passed' : 'failed'}`,
        ),
      ),
    );
    parts.push(
      section(
        'Review',
        reviews
          .filter(({ review }) => review.reviews.length > 0)
          .map(({ tp, review }) => {
            const who = [...new Set(review.reviews.map((r) => r.councillorId))].join(', ');
            const rounds = review.round === 1 ? 'round 1' : `${review.round} rounds`;
            return `- ${tp.title}: ${review.phase === 'passed' ? 'passed' : review.phase} after ${rounds} (${who})`;
          }),
      ),
    );
    return parts.filter((p) => p !== '').join('\n\n');
  }

  /** The branch the PR merges into: the island before (stacked), else the island's base. */
  private static base({ state, island }: { state: CoreState; island: Island }): string {
    return state.islands.find((i) => i.id === island.basedOn)?.branch ?? island.baseRef;
  }

  /** Core's reasons a PR can't open yet; null when it can. */
  private static blocked({ state, island }: { state: CoreState; island: Island }): string | null {
    const before = state.islands.find((i) => i.id === island.basedOn);
    if (before && !before.remote?.pullRequest)
      return `Open the pull request of ${before.name} first.`;
    if (island.remote?.busy) return 'Wait for the push to finish.';
    return null;
  }

  open(command: Extract<Command, { type: 'openPullRequest' }>): void {
    const island = this.island(command);
    if (!island?.worktreePath) return;
    if (island.remote?.pullRequest) {
      this.ctx.outbox.reject(command.commandId, 'This island already has a pull request.');
      return;
    }
    const state = this.ctx.state;
    const blocked = PullRequest.blocked({ state, island });
    if (blocked) {
      this.ctx.outbox.reject(command.commandId, blocked);
      return;
    }
    if (!command.draft && !Campaign.cleared(island)) {
      this.ctx.outbox.reject(
        command.commandId,
        'Open it as a draft until every task on the island has passed.',
      );
      return;
    }
    this.start({ island, busy: 'opening' });
    this.ctx.outbox.effect({
      type: 'openPullRequest',
      islandId: island.id,
      worktreePath: island.worktreePath,
      branch: island.branch,
      base: PullRequest.base({ state, island }),
      title: command.title,
      body: command.body,
      draft: command.draft,
    });
  }

  /** Push the branch: to the open PR (Update PR), or with no PR at all (Push branch only). */
  push(command: Extract<Command, { type: 'updatePullRequest' | 'pushBranch' }>): void {
    const island = this.island(command);
    if (!island?.worktreePath) return;
    const pr = island.remote?.pullRequest;
    if (command.type === 'updatePullRequest' && !pr) {
      this.ctx.outbox.reject(command.commandId, 'This island has no pull request yet.');
      return;
    }
    if (pr && SETTLED.has(pr.state)) {
      this.ctx.outbox.reject(command.commandId, `Its pull request is ${pr.state}.`);
      return;
    }
    if (this.busy({ island, commandId: command.commandId })) return;
    this.start({ island, busy: 'pushing' });
    this.ctx.outbox.effect({
      type: 'pushBranch',
      islandId: island.id,
      worktreePath: island.worktreePath,
      branch: island.branch,
    });
  }

  markReady(command: Extract<Command, { type: 'markPullRequestReady' }>): void {
    const island = this.island(command);
    if (!island?.worktreePath) return;
    const pr = island.remote?.pullRequest;
    if (pr?.state !== 'draft') {
      this.ctx.outbox.reject(command.commandId, 'There is no draft pull request to mark ready.');
      return;
    }
    if (!Campaign.cleared(island)) {
      this.ctx.outbox.reject(command.commandId, 'Every task on the island has to pass first.');
      return;
    }
    if (this.busy({ island, commandId: command.commandId })) return;
    this.start({ island, busy: 'markingReady' });
    this.ctx.outbox.effect({
      type: 'markPullRequestReady',
      islandId: island.id,
      worktreePath: island.worktreePath,
      branch: island.branch,
      number: pr.number,
    });
  }

  refresh(commandId: string): void {
    const numbers = this.watched();
    if (numbers.length === 0) {
      this.ctx.outbox.reject(commandId, 'There is no open pull request to refresh.');
      return;
    }
    this.ctx.outbox.effect({ type: 'pollPullRequests', numbers });
  }

  /** The runtime's results: pushes, opened and ready PRs, failures and polls. */
  handle(
    event: Extract<
      GameMasterEvent,
      {
        type:
          | 'branchPushed'
          | 'pullRequestOpened'
          | 'pullRequestReady'
          | 'remoteFailed'
          | 'pullRequestsPolled';
      }
    >,
  ): void {
    if (event.type === 'pullRequestsPolled') {
      this.polled(event.pullRequests);
      return;
    }
    const island = this.ctx.state.islands.find((i) => i.id === event.islandId);
    if (!island?.remote) return;
    const remote = island.remote;
    remote.busy = null;
    switch (event.type) {
      case 'remoteFailed':
        remote.error = event.message;
        return;
      case 'branchPushed':
        remote.pushedHead = event.head;
        return;
      case 'pullRequestOpened':
        remote.pushedHead = event.head;
        remote.pullRequest = {
          number: event.number,
          url: event.url,
          state: event.state,
          base: PullRequest.base({ state: this.ctx.state, island }),
        };
        this.watch();
        if (event.state !== 'draft') this.ready(island);
        return;
      case 'pullRequestReady':
        remote.pushedHead = event.head;
        if (remote.pullRequest) remote.pullRequest.state = 'open';
        this.ready(island);
        return;
    }
  }

  /** After a restart the runtime has forgotten what to poll. */
  restarted(): void {
    if (this.ctx.state.islands.some((i) => i.remote?.pullRequest)) this.watch();
    for (const island of this.ctx.state.islands) {
      if (island.remote?.busy) {
        island.remote.busy = null;
        island.remote.error = 'Interrupted when VS Code reloaded. Try again.';
      }
    }
  }

  private polled(pullRequests: PolledPullRequest[]): void {
    let settled = false;
    for (const polled of pullRequests) {
      const pr = this.ctx.state.islands
        .map((i) => i.remote?.pullRequest)
        .find((p) => p?.number === polled.number);
      if (!pr || pr.state === polled.state) continue;
      pr.state = polled.state;
      if (SETTLED.has(polled.state)) settled = true;
    }
    if (settled) this.watch();
  }

  /** The PR is ready for review: the hero's work on the island is over, so its session ends. */
  private ready(island: Island): void {
    for (const record of this.ctx.state.heroes.filter((h) => h.islandId === island.id)) {
      new Hero({ record, ctx: this.ctx }).endSession();
    }
  }

  /** Tell the runtime which PRs are still open (none: stop polling). */
  private watch(): void {
    this.ctx.outbox.effect({ type: 'watchPullRequests', numbers: this.watched() });
  }

  private watched(): number[] {
    return this.ctx.state.islands.flatMap((i) => {
      const pr = i.remote?.pullRequest;
      return pr && !SETTLED.has(pr.state) ? [pr.number] : [];
    });
  }

  private start({ island, busy }: { island: Island; busy: IslandRemote['busy'] }): void {
    island.remote ??= { pushedHead: null, busy: null, error: null, pullRequest: null };
    island.remote.busy = busy;
    island.remote.error = null;
  }

  private busy({ island, commandId }: { island: Island; commandId: string }): boolean {
    if (!island.remote?.busy) return false;
    this.ctx.outbox.reject(commandId, 'Wait for the push to finish.');
    return true;
  }

  /** The command's island, once it has a worktree; rejects the command otherwise. */
  private island({ islandId, commandId }: { islandId: string; commandId: string }): Island | null {
    const island = this.ctx.state.islands.find((i) => i.id === islandId);
    if (!island) this.ctx.outbox.reject(commandId, 'No such island.');
    else if (!island.worktreePath)
      this.ctx.outbox.reject(commandId, 'This island has no worktree.');
    else return island;
    return null;
  }
}

/** A heading and its lines, or nothing when there are none. */
function section(heading: string, lines: string[]): string {
  return lines.length > 0 ? `## ${heading}\n\n${lines.join('\n')}` : '';
}
