import type { Amendment } from './amendment.schema';

/** One line of an amendment's change set, as the plan review shows it (#170). */
export type AmendmentChange =
  | { kind: 'added'; taskId: string; title: string; island: string }
  | { kind: 'edited'; taskId: string; title: string; before: string; island: string }
  | { kind: 'removed'; taskId: string; title: string; island: string }
  | { kind: 'island'; islandId: string; title: string; tasks: string[] }
  | { kind: 'decision'; decisionId: string; title: string };

export type AmendmentOutcome =
  | { kind: 'proposed' }
  | { kind: 'approved' }
  | { kind: 'changeRequested'; note: string }
  | { kind: 'discarded' }
  /** A newer proposal replaced it before the user decided. */
  | { kind: 'superseded' };

/** An amendment as the snapshot shows it: Amendment `number`, its change set and what became of it. */
export interface AmendmentView {
  number: number;
  amendment: Amendment;
  changes: AmendmentChange[];
  outcome: AmendmentOutcome;
}
