import type { HostRequest } from '@ibitsa/protocol';

/** Your settings or the project's. */
export type ArmoryLayerName = 'user' | 'workspace';

/** The requests that change the Armory (#182). */
export type ArmoryRequest = Extract<
  HostRequest,
  { type: 'writeClass' | 'resetClass' | 'writeRecolor' | 'resetRecolor' }
>;
