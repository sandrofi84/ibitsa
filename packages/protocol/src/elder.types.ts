import type { ResearchBrief } from './elder.schema';
import type { MicroUsd, Reading } from './values.types';

/** What the elder's research session reports (spec §4.1); core hears it as `elder` inputs. */
export type ElderEvent =
  | { type: 'sessionStarted'; sessionId: string }
  /** What it's looking at now, e.g. "Reading src/auth.ts", for the progress line. */
  | { type: 'activity'; text: string }
  /** A brief that passed the schema and names only councillors who exist. */
  | { type: 'briefSubmitted'; brief: ResearchBrief }
  /** Running total for the research, never a delta. */
  | { type: 'usage'; totalCost: MicroUsd }
  /** The research can't finish, e.g. out of gold, or it ended without a brief. */
  | { type: 'error'; message: string };

export type ElderStatus = 'researching' | 'briefed' | 'failed';

/** The elder's research as front ends see it (spec §4.1, §7.1 screen 1). */
export interface ElderView {
  id: string;
  task: string;
  status: ElderStatus;
  /** The latest activity while researching. */
  progress: string | null;
  brief: ResearchBrief | null;
  gold: Reading<MicroUsd>;
  error: string | null;
}
