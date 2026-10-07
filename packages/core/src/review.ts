import type {
  AgentEvent,
  CheckResult,
  Command,
  Finding,
  ReviewEvent,
  TaskReviewView,
} from '@ibitsa/protocol';
import { checkVerdict } from '@ibitsa/protocol';
import { Hero } from './hero';
import type { CoreInput } from './inputs.types';
import type { TaskPoint } from './review.types';
import { Sitting } from './sitting';
import { newId } from './state';
import type { HeroRecord, Island, ReviewRecord, TaskReview } from './state.types';
import type { StepContext } from './step.types';

/**
 * The review loop (spec §5.5, M5): a submitted task runs the checks, then every councillor with criteria
 * for it reviews it at once; any blocking finding sends it back to the hero, and only those councillors
 * review again, on what changed. After the loop limit, or when a reviewer can't finish, it goes to the
 * user. A task without reviewers (a quick quest) is done once its checks pass. The rules are core's:
 * reviewers only report.
 */
export class Review {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  static view(review: TaskReview): TaskReviewView {
    return {
      round: review.round,
      phase: review.phase,
      checks: review.checks,
      reviews: review.reviews.map(({ head: _head, waived: _waived, ...visible }) => visible),
      suggestions: review.suggestions,
    };
  }

  /** PR comments reopened a passed task (#154): its next submit starts a fresh round. */
  static reopen(review: TaskReview): void {
    review.round++;
    review.followUpRound = review.round;
    review.phase = 'changes';
  }

  /** The hero submitted (or was marked done): check, then review. */
  begin({ hero, summary, head }: { hero: HeroRecord; summary: string; head: string | null }): void {
    const found = this.taskOf(hero);
    if (!found) return;
    const { task, island } = found;
    task.state = 'underReview';
    task.submitHead = head;
    task.review ??= {
      round: 1,
      phase: 'checks',
      checks: null,
      reviews: [],
      suggestions: [],
      summary,
    };
    task.review.phase = 'checks';
    task.review.summary = summary;
    if (!island.worktreePath) return;
    this.ctx.outbox.effect({
      type: 'runChecks',
      taskPointId: task.id,
      worktreePath: island.worktreePath,
    });
  }

  checksRan({ taskPointId, results }: { taskPointId: string; results: CheckResult[] }): void {
    const found = this.find(taskPointId);
    const review = found?.task.review;
    if (!found || !review || review.phase !== 'checks') return;
    const { task, island, hero } = found;
    review.checks = results;
    const failed = results.find((r) => !r.ok);
    if (failed) {
      review.phase = 'changes';
      task.state = 'active';
      this.tell({
        hero,
        text: `The check \`${failed.command}\` failed:\n\n${failed.output}\n\nFix it, commit, and call submit_task again.`,
      });
      return;
    }
    const reviewers = this.reviewersFor(task, review);
    if (reviewers.length === 0) {
      this.pass({ task, hero });
      return;
    }
    review.phase = 'reviewing';
    for (const councillorId of reviewers) {
      const record: ReviewRecord = {
        id: newId(this.ctx.state, 'r'),
        councillorId,
        effort: island.reviewEfforts?.[councillorId] ?? 'light',
        round: review.round,
        status: 'running',
        verdict: null,
        error: null,
        gold: { kind: 'unknown' },
        head: task.submitHead ?? null,
        waived: false,
      };
      review.reviews.push(record);
      this.startReviewer({ island, task, record });
    }
  }

  /**
   * VS Code reloaded (§12, #166): checks that were running run again, and reviewers that were running
   * start over with a fresh session. Returns how many of each, for the restart notice.
   */
  restarted(): { checks: number; reviews: number } {
    const restarted = { checks: 0, reviews: 0 };
    for (const island of this.ctx.state.islands) {
      for (const task of island.taskPoints) {
        const review = task.review;
        if (!review || !island.worktreePath || task.state !== 'underReview') continue;
        if (review.phase === 'checks') {
          restarted.checks++;
          this.ctx.outbox.effect({
            type: 'runChecks',
            taskPointId: task.id,
            worktreePath: island.worktreePath,
          });
        } else if (review.phase === 'reviewing') {
          for (const record of review.reviews.filter((r) => r.status === 'running')) {
            restarted.reviews++;
            this.startReviewer({ island, task, record });
          }
        }
      }
    }
    return restarted;
  }

  /** A reviewer's session, for a review record in the task's current round. */
  private startReviewer({
    island,
    task,
    record,
  }: {
    island: Island;
    task: TaskPoint;
    record: ReviewRecord;
  }): void {
    const review = task.review;
    if (!review) return;
    const plan = Sitting.approvedPlan(this.ctx.state);
    const planTask = plan?.tasks.find((t) => t.id === task.planTaskId);
    const decisions = plan?.decisions.filter((d) => planTask?.decisions.includes(d.id)) ?? [];
    const before = review.reviews
      .filter((r) => r.councillorId === record.councillorId && r.status === 'done')
      .at(-1);
    this.ctx.outbox.effect({
      type: 'startReview',
      reviewId: record.id,
      taskPointId: task.id,
      councillorId: record.councillorId,
      effort: record.effort,
      round: record.round,
      worktreePath: island.worktreePath ?? '',
      from: this.startOf({ island, task }),
      to: task.submitHead ?? null,
      since: before?.head ?? null,
      task: { title: task.title, description: task.description },
      criteria: planTask?.criteria.find((c) => c.councillorId === record.councillorId)?.items ?? [],
      decisions,
      checks: review.checks ?? [],
    });
  }

  handle({ reviewId, event }: Extract<CoreInput, { kind: 'review' }>): void {
    const found = this.findReview(reviewId);
    if (!found) return;
    const { record, task, hero } = found;
    if (record.status !== 'running') {
      // A finished reviewer's session reports its cost as it ends (#138).
      if (event.type === 'usage') record.gold = { kind: 'exact', value: event.totalCost };
      if (event.type === 'verdictSubmitted')
        this.complete({ reviewId, toolUseId: event.toolUseId, reason: 'This review has ended.' });
      return;
    }
    switch (event.type) {
      case 'sessionStarted':
        return;
      case 'usage':
        record.gold = { kind: 'exact', value: event.totalCost };
        return;
      case 'error':
        record.status = 'failed';
        record.error = event.message;
        this.ctx.outbox.effect({ type: 'closeReview', reviewId });
        this.roundDone({ task, hero });
        return;
      case 'verdictSubmitted':
        this.verdict({ record, task, hero, event });
        return;
    }
  }

  /** The hero says findings contradict each other or a decision: the user decides. */
  disputed({
    hero,
    event,
  }: {
    hero: HeroRecord;
    event: Extract<AgentEvent, { type: 'findingDisputed' }>;
  }): void {
    const found = this.taskOf(hero);
    const review = found?.task.review;
    if (!found || !review) return;
    const records = review.reviews.filter((r) => event.reviewIds.includes(r.id));
    this.ctx.needsYou.ask({
      kind: 'dispute',
      heroId: hero.id,
      taskPointId: found.task.id,
      reason: event.reason,
      reviewIds: records.map((r) => r.id),
      findings: records.flatMap((r) => blockingOf(r)),
    });
  }

  resolve(command: Extract<Command, { type: 'resolveReview' }>): void {
    const item = this.ctx.state.needsYou.find((i) => i.id === command.itemId);
    const found = item?.kind === 'reviewEscalation' ? this.find(item.taskPointId) : undefined;
    if (item?.kind !== 'reviewEscalation' || !found?.task.review) {
      this.ctx.outbox.reject(command.commandId, 'That review is no longer waiting.');
      return;
    }
    this.ctx.state.needsYou = this.ctx.state.needsYou.filter((i) => i.id !== item.id);
    const { task, hero } = found;
    if (command.decision === 'accept') {
      this.pass({ task, hero });
    } else if (command.decision === 'sendBack') {
      this.sendBack({ task, hero, note: command.note });
    } else {
      new Hero({ record: hero, ctx: this.ctx }).stop();
    }
  }

  resolveDispute(command: Extract<Command, { type: 'resolveDispute' }>): void {
    const item = this.ctx.state.needsYou.find((i) => i.id === command.itemId);
    if (item?.kind !== 'dispute') {
      this.ctx.outbox.reject(command.commandId, 'That dispute is no longer waiting.');
      return;
    }
    this.ctx.state.needsYou = this.ctx.state.needsYou.filter((i) => i.id !== item.id);
    const hero = this.ctx.state.heroes.find((h) => h.id === item.heroId);
    const review = this.find(item.taskPointId)?.task.review;
    if (!hero || !review) return;
    const note = command.note ? `\n\n${command.note}` : '';
    if (command.decision === 'drop') {
      for (const r of review.reviews) if (item.reviewIds.includes(r.id)) r.waived = true;
      this.tell({ hero, text: `The user dropped the disputed findings: ignore them.${note}` });
    } else {
      this.tell({ hero, text: `The user keeps the disputed findings: address them.${note}` });
    }
  }

  /** Every reviewer's spend, for the campaign's total. */
  static spenders(islands: Island[]): { gold: ReviewRecord['gold'] }[] {
    return islands.flatMap((i) => i.taskPoints.flatMap((tp) => tp.review?.reviews ?? []));
  }

  // ---------- internals ----------

  private verdict({
    record,
    task,
    hero,
    event,
  }: {
    record: ReviewRecord;
    task: TaskPoint;
    hero: HeroRecord;
    event: Extract<ReviewEvent, { type: 'verdictSubmitted' }>;
  }): void {
    const decisions = Sitting.approvedPlan(this.ctx.state)?.decisions.map((d) => d.id) ?? [];
    const checked = checkVerdict({ input: event.verdict, decisions });
    if (!checked.ok) {
      this.complete({
        reviewId: record.id,
        toolUseId: event.toolUseId,
        reason: `The verdict has problems:\n- ${checked.problems.join('\n- ')}`,
      });
      return;
    }
    record.verdict = checked.verdict;
    record.status = 'done';
    this.complete({ reviewId: record.id, toolUseId: event.toolUseId });
    this.ctx.outbox.effect({ type: 'closeReview', reviewId: record.id });
    const review = task.review;
    for (const f of checked.verdict.findings) {
      if (f.severity !== 'suggestion') continue;
      review?.suggestions.push({ ...f, councillorId: record.councillorId });
      if (f.revisit) {
        this.ctx.needsYou.ask({
          kind: 'revisitDecision',
          heroId: hero.id,
          councillorId: record.councillorId,
          decisionId: f.revisit,
          message: f.message,
        });
      }
    }
    this.roundDone({ task, hero });
  }

  /** Once every review of the round is in: pass, send back, or go to the user. */
  private roundDone({ task, hero }: { task: TaskPoint; hero: HeroRecord }): void {
    const review = task.review;
    if (!review) return;
    const round = review.reviews.filter((r) => r.round === review.round);
    if (round.some((r) => r.status === 'running')) return;
    const failed = round.some((r) => r.status === 'failed');
    const open = this.open(review);
    if (!failed && open.length === 0) {
      this.pass({ task, hero });
      return;
    }
    const rounds = review.round - (review.followUpRound ?? 1) + 1;
    if (failed || rounds >= this.ctx.state.settings.loopLimit) {
      review.phase = 'escalated';
      this.ctx.needsYou.ask({
        kind: 'reviewEscalation',
        heroId: hero.id,
        taskPointId: task.id,
        reason: failed ? 'reviewFailed' : 'loopLimit',
        findings: open.flatMap((r) => blockingOf(r)),
      });
      return;
    }
    this.sendBack({ task, hero });
  }

  /** The open blocking findings go to the hero; the next round starts when it submits again. */
  private sendBack({
    task,
    hero,
    note,
  }: {
    task: TaskPoint;
    hero: HeroRecord;
    note?: string | undefined;
  }): void {
    const review = task.review;
    if (!review) return;
    // Each finding names its review, so the hero can dispute it by id (`dispute_finding`).
    const lines = this.open(review).flatMap((r) =>
      blockingOf(r).map((f) => {
        const where = f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : '';
        const why = f.criterion ? `criterion "${f.criterion}"` : (f.kind ?? 'blocking');
        return `- ${f.councillorId}, ${why}${where}: ${f.message} [review ${r.id}]`;
      }),
    );
    review.round++;
    review.phase = 'changes';
    task.state = 'active';
    const intro =
      lines.length > 0 ? `The review found:\n${lines.join('\n')}` : 'The user sent the task back.';
    const extra = note ? `\n\nThe user adds: ${note}` : '';
    this.tell({
      hero,
      text: `${intro}${extra}\n\nFix these, commit, and call submit_task again. If two findings contradict each other or a recorded decision, call dispute_finding with their review ids instead.`,
    });
  }

  private pass({ task, hero }: { task: TaskPoint; hero: HeroRecord }): void {
    if (task.review) task.review.phase = 'passed';
    new Hero({ record: hero, ctx: this.ctx }).taskDone({
      summary: task.review?.summary ?? '',
      state: 'done',
    });
  }

  /** Councillors with criteria for the task; after the first round, only those with open blocking findings. */
  private reviewersFor(task: TaskPoint, review: TaskReview): string[] {
    const planTask = Sitting.approvedPlan(this.ctx.state)?.tasks.find(
      (t) => t.id === task.planTaskId,
    );
    const all = (planTask?.criteria ?? []).map((c) => c.councillorId);
    const fresh =
      review.followUpRound === review.round || !review.reviews.some((r) => r.status === 'done');
    if (fresh) return [...new Set(all)];
    return [...new Set(this.open(review).map((r) => r.councillorId))];
  }

  /** Each councillor's latest review that still blocks. */
  private open(review: TaskReview): ReviewRecord[] {
    const latest = new Map<string, ReviewRecord>();
    for (const r of review.reviews) if (r.status === 'done') latest.set(r.councillorId, r);
    return [...latest.values()].filter((r) => !r.waived && r.verdict?.verdict === 'changes');
  }

  /** Where the task's commits start: the previous task's submitted head, or the island's base. */
  private startOf({ island, task }: { island: Island; task: TaskPoint }): string {
    const index = island.taskPoints.indexOf(task);
    return island.taskPoints[index - 1]?.submitHead ?? island.baseRef;
  }

  private tell({ hero, text }: { hero: HeroRecord; text: string }): void {
    this.ctx.outbox.effect({ type: 'sendMessage', heroId: hero.id, text, priority: 'next' });
  }

  private complete({
    reviewId,
    toolUseId,
    reason,
  }: {
    reviewId: string;
    toolUseId: string;
    reason?: string;
  }): void {
    this.ctx.outbox.effect({
      type: 'completeReviewTool',
      reviewId,
      toolUseId,
      accepted: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
    });
  }

  private taskOf(hero: HeroRecord): { task: TaskPoint; island: Island } | undefined {
    const island = this.ctx.state.islands.find((i) => i.id === hero.islandId);
    const task = island?.taskPoints.find((tp) => tp.id === hero.taskPointId);
    return island && task ? { task, island } : undefined;
  }

  private find(
    taskPointId: string,
  ): { task: TaskPoint; island: Island; hero: HeroRecord } | undefined {
    for (const island of this.ctx.state.islands) {
      const task = island.taskPoints.find((tp) => tp.id === taskPointId);
      const hero = this.ctx.state.heroes.find((h) => h.islandId === island.id);
      if (task && hero) return { task, island, hero };
    }
    return undefined;
  }

  private findReview(
    reviewId: string,
  ): { record: ReviewRecord; task: TaskPoint; hero: HeroRecord } | undefined {
    for (const island of this.ctx.state.islands) {
      for (const task of island.taskPoints) {
        const record = task.review?.reviews.find((r) => r.id === reviewId);
        const hero = this.ctx.state.heroes.find((h) => h.islandId === island.id);
        if (record && hero) return { record, task, hero };
      }
    }
    return undefined;
  }
}

/** A review's blocking findings, by its councillor. */
function blockingOf(record: ReviewRecord): (Finding & { councillorId: string })[] {
  return (record.verdict?.findings ?? [])
    .filter((f) => f.severity === 'blocking')
    .map((f) => ({ ...f, councillorId: record.councillorId }));
}
