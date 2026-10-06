import type { ActivityKind, Snapshot } from './snapshot.types';

/** Core → front end. `seq` is monotonic: drop stale snapshots and cues older than the shown snapshot. */
export type CoreMessage =
  | { type: 'welcome'; seq: number; protocolVersion: number }
  | { type: 'snapshot'; seq: number; snapshot: Snapshot }
  | { type: 'cue'; seq: number; cue: Cue };

/** Fire-and-forget effects (animation, sound, toast). Carry no state: dropping any cue must be harmless. */
export type Cue =
  | { type: 'commandRejected'; commandId: string; reason: string }
  | { type: 'needsYouAdded'; itemId: string }
  | { type: 'activityFinished'; heroId: string; kind: ActivityKind; outcome: 'ok' | 'failed' }
  | { type: 'retrying'; heroId: string; reason: string }
  /** The hero said something; the game shows an excerpt in a speech bubble (#57). */
  | { type: 'heroSaid'; heroId: string; text: string };
