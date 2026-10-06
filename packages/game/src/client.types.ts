import type { Command } from '@ibitsa/protocol';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CommandIntent = DistributiveOmit<Exclude<Command, { type: 'hello' }>, 'commandId'>;

/** How saving a new action went (#86). */
export type ActionResult =
  | { ok: true; name: string }
  | { ok: false; name: string; reason: string; clash: boolean };
