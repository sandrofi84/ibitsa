import { type CoreState, initialState, step, view } from '@ibitsa/core';
import type { Cue, Snapshot } from '@ibitsa/protocol';
import type { EventLog } from './log';

export interface ReplayOutput {
  cues: { t: number; cue: Cue }[];
  marks: { mark: string; t: number; snapshot: Snapshot }[];
  final: Snapshot;
}

/** Replays a whole log through a fresh core at `instant` speed, without carrying out effects (ADR 0001). */
export function replayThroughCore(log: EventLog): ReplayOutput {
  let state: CoreState = initialState();
  const output: ReplayOutput = { cues: [], marks: [], final: view(state) };
  for (const record of log.records) {
    const { mark, ...input } = record;
    const result = step(state, input);
    state = result.state;
    output.cues.push(...result.cues.map((cue) => ({ t: record.t, cue })));
    if (mark) output.marks.push({ mark, t: record.t, snapshot: view(state) });
  }
  output.final = view(state);
  return output;
}
