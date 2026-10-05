import type { Command } from '@ibitsa/protocol';
import type { PendingItem } from './state.types';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An item before the queue gives it an id. */
export type NewItem = DistributiveOmit<PendingItem, 'id'>;

export type AnswerCommand = Extract<Command, { type: 'answerPermission' | 'answerQuestion' }>;
