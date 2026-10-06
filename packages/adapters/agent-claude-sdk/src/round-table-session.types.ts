import type { CouncilEvent, CouncilQuestion } from '@ibitsa/protocol';
import type { SittingStart } from '@ibitsa/runtime';
import type { ClaudeAdapterOptions } from './claude-adapter.types';

export interface RoundTableInit {
  adapter: ClaudeAdapterOptions;
  start: SittingStart;
  onEvent: (event: CouncilEvent) => void;
}

/** A councillor at the table: who it is and what it brings to planning. */
export interface Seat {
  id: string;
  title: string;
  guidance: string;
}

/** Core's verdict on a tool call, waited for by its handler. */
export interface Verdict {
  accepted: boolean;
  reason?: string;
}

/** An accepted `ask_user` batch, kept to word the answers when they come. */
export interface AskedBatch {
  questions: CouncilQuestion[];
}
