import type { ActionInfo } from '@ibitsa/protocol';

/** What the standalone build answers `createAction` with, before its message numbers are added. */
export type DevActionReply =
  | { type: 'actionCreated'; name: string }
  | { type: 'actionRejected'; name: string; reason: string; clash: boolean }
  | { type: 'actions'; actions: ActionInfo[] };
