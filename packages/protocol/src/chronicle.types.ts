import type { PullRequestState } from './pull-request.types';
import type { MicroUsd } from './values.types';

/**
 * A past campaign (§4.1, §7.1): the elder's index (#168) and the Guild Hall's Chronicle (#179), read
 * from its `record.md`.
 */
export interface ChronicleEntry {
  campaignId: string;
  title: string;
  /** `YYYY-MM-DD`, when its record was written. */
  date: string;
  status: 'finished' | 'abandoned';
  /** The plan's summary, when it had one. */
  summary: string | null;
  /** The record, relative to the repository. */
  path: string;
  pullRequests: { number: number; url: string; state: PullRequestState }[];
  /** What it spent, as the record says; null when unknown. */
  gold: MicroUsd | null;
}
