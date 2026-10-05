import type { Command } from '@ibitsa/protocol';

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type CommandIntent = DistributiveOmit<Exclude<Command, { type: 'hello' }>, 'commandId'>;
