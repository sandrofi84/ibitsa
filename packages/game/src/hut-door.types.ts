import type { Snapshot } from '@ibitsa/protocol';

/**
 * What the hut shows: the council's sitting, the elder alone (the welcome, its research and its brief,
 * #244), or nothing (the map).
 */
export type HutPlace = 'sitting' | 'elder' | null;

/** The part of a snapshot that decides whether the hut shows. */
export type HutDoorInput = Pick<Snapshot, 'campaign' | 'elder' | 'sitting'> | null;

/** The campaign, and its sitting if any, the user walked out of. */
export interface LeftHut {
  campaignId: string;
  sittingId: string | null;
}
