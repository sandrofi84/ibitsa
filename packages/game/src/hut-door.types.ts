import type { Snapshot } from '@ibitsa/protocol';

/** What the hut shows: the council's sitting, or nothing (the map). */
export type HutPlace = 'sitting' | null;

/** The part of a snapshot that decides whether the hut shows. */
export type HutDoorInput = Pick<Snapshot, 'campaign' | 'sitting'> | null;
