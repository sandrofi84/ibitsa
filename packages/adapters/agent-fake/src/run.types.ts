import type { Cue, Snapshot } from '@ibitsa/protocol';

export interface ReplayOutput {
  cues: { t: number; cue: Cue }[];
  marks: { mark: string; t: number; snapshot: Snapshot }[];
  final: Snapshot;
}
