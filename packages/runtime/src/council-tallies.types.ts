import type { SittingTally } from '@ibitsa/protocol';

/** A sitting's tally with the campaign it belongs to, as exported (§4.10). */
export interface ExportedTally extends SittingTally {
  campaignId: string;
  campaignTitle: string | null;
  /** When the sitting convened, from the log's start and core's clock. */
  convenedAt: string;
}
