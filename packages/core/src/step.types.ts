import type { Cue } from '@ibitsa/protocol';
import type { Effect } from './effects.types';
import type { NeedsYou } from './needs-you';
import type { Outbox } from './outbox';
import type { CoreState } from './state.types';

export interface StepResult {
  state: CoreState;
  cues: Cue[];
  effects: Effect[];
}

/** What every domain class works on during one step: the draft state, the outbox, the queue, now. */
export interface StepContext {
  state: CoreState;
  outbox: Outbox;
  needsYou: NeedsYou;
  /** Milliseconds since the log header: core's only clock (ADR 0001). */
  t: number;
}
