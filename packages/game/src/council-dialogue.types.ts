import type { CouncilQuestion, DialogueLine } from '@ibitsa/protocol';

/** The batch the dialogue box steps through: one `ask_user` call (§4.4). */
export interface DialogueBatch {
  batchId: string;
  items: (CouncilQuestion & { id: string })[];
}

/** A question's answer so far: one of its options, or the user's own words. */
export type DraftAnswer = { optionId: string } | { text: string };

/** What the box shows for the question it's on. */
export interface DialogueStep {
  question: CouncilQuestion & { id: string };
  /** 1-based position in the batch, and how many there are. */
  position: number;
  count: number;
  answer: DraftAnswer | null;
  /** "Why?" and the replies to it: lines about this question and the chime-ins that follow them. */
  lines: DialogueLine[];
}
