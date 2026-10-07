import type { CampaignEndView, Command, MicroUsd, Reading } from '@ibitsa/protocol';
import type { CampaignRecordData } from './campaign-record.types';
import type { CoreInput, GameMasterEvent } from './inputs.types';
import { Quest } from './quest';
import { Review } from './review';
import { Sitting } from './sitting';
import { newId } from './state';
import type { CampaignEnd, CoreState } from './state.types';
import type { StepContext } from './step.types';

const DONE = new Set(['done', 'doneUnreviewed']);

/**
 * The end of a campaign (spec §4.9, #167). On Finish or Abandon the record is gathered from state with
 * no tokens; when the reviews left something to learn from, the elder first writes a few lessons in a
 * short session on a cheap model. After Finish the user chooses what happens to the council's context
 * (empty by default); Abandon empties it without asking.
 */
export class CampaignRecord {
  private readonly ctx: StepContext;

  constructor(ctx: StepContext) {
    this.ctx = ctx;
  }

  /** The campaign's gold: the elder, the heroes, the reviewers and the lessons, when known. */
  static gold(state: CoreState): Reading<MicroUsd> {
    const lessons = state.campaign?.ending?.lessonsGold;
    return Quest.totalGold([
      ...(state.elder && state.elder.gold.kind !== 'unknown' ? [state.elder] : []),
      ...state.heroes,
      ...Review.spenders(state.islands).filter((r) => r.gold.kind !== 'unknown'),
      ...(lessons && lessons.kind !== 'unknown' ? [{ gold: lessons }] : []),
    ]);
  }

  static view({ ending, state }: { ending: CampaignEnd; state: CoreState }): CampaignEndView {
    const usage = state.sitting?.usage.byModel ?? [];
    // Roughly what the council's context holds: what was written into it, not each turn's re-reads.
    const tokens = usage.reduce(
      (n, m) => n + m.inputTokens + m.outputTokens + m.cacheWriteTokens,
      0,
    );
    return {
      record: ending.record,
      recordPath: ending.recordPath,
      recordError: ending.recordError,
      councilContext: ending.councilContext,
      councilTokens: ending.councilContext && usage.length > 0 ? tokens : null,
      lessonsGold: ending.lessonsGold,
    };
  }

  /**
   * What the elder learns from: each reviewed task's rounds, its blocking findings, failed reviews,
   * findings dropped after a dispute and PR comments that reopened it. Null when nothing was reviewed.
   */
  static material(state: CoreState): string | null {
    const lines: string[] = [];
    for (const island of state.islands) {
      for (const task of island.taskPoints) {
        const review = task.review;
        if (!review || (review.reviews.length === 0 && review.round === 1)) continue;
        const rounds = review.round === 1 ? '1 round' : `${review.round} rounds`;
        lines.push(`Task "${task.title}" (${island.name}): ${review.phase} after ${rounds}.`);
        if (review.followUpRound) {
          lines.push(`- Pull request comments reopened it at round ${review.followUpRound}.`);
        }
        for (const r of review.reviews) {
          if (r.status === 'failed')
            lines.push(
              `- Round ${r.round}, ${r.councillorId}'s review failed: ${r.error ?? 'no reason'}.`,
            );
          if (r.waived)
            lines.push(`- ${r.councillorId}'s findings were dropped after the hero disputed them.`);
          for (const f of r.verdict?.findings ?? []) {
            if (f.severity === 'blocking')
              lines.push(`- Round ${r.round}, ${r.councillorId} blocked: ${f.message}`);
          }
        }
      }
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  /** Everything `record.md` says, from state. */
  static data(state: CoreState): CampaignRecordData {
    const plan = Sitting.approvedPlan(state);
    const campaign = state.campaign;
    const sittings = [...state.pastSittings, ...(state.sitting ? [state.sitting] : [])];
    return {
      title: campaign?.title ?? 'Campaign',
      status: campaign?.status === 'abandoned' ? 'abandoned' : 'finished',
      summary: plan?.summary ?? null,
      decisions: plan?.decisions ?? [],
      islands: state.islands.map((i) => ({
        name: i.name,
        branch: i.branch,
        tasks: i.taskPoints.map((tp) => ({ title: tp.title, state: tp.state })),
        pullRequest: i.remote?.pullRequest
          ? {
              number: i.remote.pullRequest.number,
              url: i.remote.pullRequest.url,
              state: i.remote.pullRequest.state,
            }
          : null,
      })),
      deferred: {
        unfinished: state.islands.flatMap((i) =>
          i.taskPoints.filter((tp) => !DONE.has(tp.state)).map((tp) => `${i.name}: ${tp.title}`),
        ),
        suggestions: state.islands.flatMap((i) =>
          i.taskPoints.flatMap((tp) =>
            (tp.review?.suggestions ?? []).map((f) => ({
              councillorId: f.councillorId,
              message: f.message,
              ...(f.file ? { file: f.file } : {}),
              ...(f.line ? { line: f.line } : {}),
            })),
          ),
        ),
        revisits: campaign?.revisitsDismissed ?? [],
      },
      gold: CampaignRecord.gold(state),
      tallies: sittings.map((s) => Sitting.tally(s)),
      lessons: campaign?.ending?.lessons ?? null,
    };
  }

  /** The campaign just ended: the elder's lessons first when there's something to learn from, then the record. */
  begin(status: 'finished' | 'abandoned'): void {
    const state = this.ctx.state;
    const campaign = state.campaign;
    if (!campaign || campaign.ending) return;
    const material = CampaignRecord.material(state);
    const lessonsId = material ? newId(state, 'l') : null;
    campaign.ending = {
      record: lessonsId ? 'lessons' : 'writing',
      recordPath: null,
      recordError: null,
      lessonsId,
      lessons: null,
      lessonsGold: lessonsId ? { kind: 'unknown' } : { kind: 'exact', value: 0 },
      // Only a council that sat has a context to keep; Abandon empties it without asking.
      councilContext: status === 'finished' && state.sitting?.sessionId ? 'pending' : null,
    };
    if (status === 'abandoned' && state.sitting?.sessionId) {
      this.ctx.outbox.effect({ type: 'councilContext', choice: 'empty', sessionId: null });
    }
    if (lessonsId && material) {
      this.ctx.outbox.effect({ type: 'startLessons', lessonsId, material });
      return;
    }
    this.write();
  }

  /** The lessons session's events: its lessons, then its cost, which is when the record is written. */
  handle({ lessonsId, event }: Extract<CoreInput, { kind: 'lessons' }>): void {
    const ending = this.ctx.state.campaign?.ending;
    if (!ending || ending.lessonsId !== lessonsId) return;
    switch (event.type) {
      case 'sessionStarted':
        return;
      case 'lessonsSubmitted':
        ending.lessons = event.lessons;
        return;
      case 'usage':
        ending.lessonsGold = { kind: 'exact', value: event.totalCost };
        if (ending.record === 'lessons') this.write();
        return;
      case 'error':
        // The record goes out without lessons; the session's cost may still arrive.
        if (ending.record === 'lessons') this.write();
        return;
    }
  }

  /** The runtime saved `record.md`, or couldn't. */
  written(event: Extract<GameMasterEvent, { type: 'recordWritten' | 'recordFailed' }>): void {
    const ending = this.ctx.state.campaign?.ending;
    if (!ending) return;
    if (event.type === 'recordWritten') {
      ending.record = 'written';
      ending.recordPath = event.path;
    } else {
      ending.record = 'failed';
      ending.recordError = event.message;
    }
  }

  /** After Finish: empty (the default), compact or keep the council's context for the next campaign. */
  chooseContext(command: Extract<Command, { type: 'chooseCouncilContext' }>): void {
    const ending = this.ctx.state.campaign?.ending;
    if (ending?.councilContext !== 'pending') {
      this.ctx.outbox.reject(command.commandId, 'There is no council context to choose for.');
      return;
    }
    ending.councilContext = command.choice;
    this.ctx.outbox.effect({
      type: 'councilContext',
      choice: command.choice,
      sessionId: this.ctx.state.sitting?.sessionId ?? null,
    });
  }

  private write(): void {
    const ending = this.ctx.state.campaign?.ending;
    if (!ending) return;
    ending.record = 'writing';
    this.ctx.outbox.effect({ type: 'writeRecord', record: CampaignRecord.data(this.ctx.state) });
  }
}
