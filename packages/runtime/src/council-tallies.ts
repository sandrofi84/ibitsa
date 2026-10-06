import { initialState, Sitting, step } from '@ibitsa/core';
import type { ExportedTally } from './council-tallies.types';
import type { CampaignStore } from './storage';

/**
 * "Ibitsa: Export council tallies" (spec §4.10, #106): every sitting in every campaign log, replayed
 * through core and tallied, so round tables and separate chambers (and later versions of either) can be
 * compared. Nothing is stored apart from the logs.
 */
export class CouncilTallies {
  constructor(private readonly store: CampaignStore) {}

  all(): ExportedTally[] {
    return this.store.ids().flatMap((campaignId) => {
      let log: ReturnType<CampaignStore['read']>;
      try {
        log = this.store.read(campaignId);
      } catch {
        return []; // An unreadable log has nothing to tally.
      }
      let state = initialState();
      for (const { mark: _mark, ...record } of log.records) state = step(state, record).state;
      const sittings = state.sitting ? [...state.pastSittings, state.sitting] : state.pastSittings;
      const started = Date.parse(log.header.startedAt);
      return sittings.map((record) => ({
        campaignId,
        campaignTitle: state.campaign?.title ?? null,
        convenedAt: new Date(started + record.startedAt).toISOString(),
        ...Sitting.tally(record),
      }));
    });
  }

  json(): string {
    return `${JSON.stringify(this.all(), null, 2)}\n`;
  }

  /** One row per sitting; tokens summed over models, the roster as `id:effort` pairs. */
  csv(): string {
    const columns: [string, (t: ExportedTally) => unknown][] = [
      ['campaignId', (t) => t.campaignId],
      ['campaignTitle', (t) => t.campaignTitle],
      ['sittingId', (t) => t.sittingId],
      ['convenedAt', (t) => t.convenedAt],
      ['mode', (t) => t.mode],
      ['councilVersion', (t) => t.councilVersion],
      ['comparisonOf', (t) => t.comparisonOf],
      ['outcome', (t) => t.outcome],
      ['durationMs', (t) => t.durationMs],
      ['costUsd', (t) => (t.cost.totalMicroUsd === null ? null : t.cost.totalMicroUsd / 1_000_000)],
      ['inputTokens', (t) => sum(t.cost.byModel.map((m) => m.inputTokens))],
      ['outputTokens', (t) => sum(t.cost.byModel.map((m) => m.outputTokens))],
      ['cacheReadTokens', (t) => sum(t.cost.byModel.map((m) => m.cacheReadTokens))],
      ['cacheWriteTokens', (t) => sum(t.cost.byModel.map((m) => m.cacheWriteTokens))],
      ['models', (t) => t.cost.byModel.map((m) => m.model).join(';')],
      ['effort', (t) => t.effort],
      ['elderEffort', (t) => t.elderEffort],
      ['roster', (t) => t.roster.map((c) => `${c.councillorId}:${c.effort}`).join(';')],
      ['changedElderPicks', (t) => t.changedElderPicks],
      ['reports', (t) => t.reports],
      ['bowOuts', (t) => t.bowOuts],
      ['concerns', (t) => t.concerns],
      ['seriousConcerns', (t) => t.seriousConcerns],
      ['questionsAsked', (t) => t.questionsAsked],
      ['whys', (t) => t.whys],
      ['revisions', (t) => t.revisions],
      ['reconsultations', (t) => t.reconsultations],
      ['plansProposed', (t) => t.plansProposed],
      ['planTasks', (t) => t.planTasks],
      ['planDecisions', (t) => t.planDecisions],
      ['planCriteria', (t) => t.planCriteria],
      ['rating', (t) => t.rating?.score ?? null],
      ['ratingNote', (t) => t.rating?.note ?? null],
    ];
    const rows = this.all().map((t) => columns.map(([, read]) => cell(read(t))).join(','));
    return `${[columns.map(([name]) => name).join(','), ...rows].join('\n')}\n`;
  }
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** A CSV cell: empty for null, quoted when it holds a comma, quote or line break. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
