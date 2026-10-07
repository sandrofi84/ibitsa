import type { CampaignEndView, CouncilContextChoice } from '@ibitsa/protocol';

/** What the end-of-campaign dialog says and offers, from the snapshot (spec §4.9, #167). */
export interface CampaignEndModel {
  heading: string;
  /** Where the record stands, in words. */
  record: string;
  /** The question about the council's context, while it's waiting for an answer. */
  question: string | null;
  choices: { id: CouncilContextChoice; label: string; note: string }[];
  /** What was chosen, once it was. */
  chosen: string | null;
  /** Nothing is under way any more: the dialog can be closed. */
  closable: boolean;
}

export interface CampaignEndInput {
  status: 'finished' | 'abandoned';
  ending: CampaignEndView;
}
