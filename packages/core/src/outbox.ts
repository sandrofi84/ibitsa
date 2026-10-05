import type { Cue } from '@ibitsa/protocol';
import type { Effect } from './effects.types';

/** What one step produces besides the new state: cues for front ends and effects for the runtime. */
export class Outbox {
  readonly cues: Cue[] = [];
  readonly effects: Effect[] = [];

  cue(cue: Cue): void {
    this.cues.push(cue);
  }

  effect(effect: Effect): void {
    this.effects.push(effect);
  }

  reject(commandId: string, reason: string): void {
    this.cues.push({ type: 'commandRejected', commandId, reason });
  }
}
