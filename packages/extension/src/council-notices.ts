import type { SittingView } from '@ibitsa/protocol';
import type { Noticed } from './council-notices.types';

/**
 * What's new from the council since `noticed` (#103): a new batch of questions, a plan waiting for
 * approval, or the council waiting on the user (#242). Returns the notification text, or null, and
 * what's now been noticed.
 */
export function councilNews({
  sitting,
  noticed,
}: {
  sitting: SittingView | null;
  noticed: Noticed;
}): { text: string | null; noticed: Noticed } {
  if (!sitting) return { text: null, noticed };
  const batch = sitting.questions;
  const last = sitting.status === 'awaitingApproval' ? sitting.plans.at(-1) : undefined;
  const plan = last ? `${sitting.id}:${last.version}` : null;
  const n = batch?.items.length ?? 0;
  const waiting = sitting.waiting ? `${sitting.id}:${sitting.dialogue.length}` : null;
  const text =
    batch && batch.batchId !== noticed.batch
      ? `The council has ${n === 1 ? 'a question' : `${n} questions`} for you.`
      : last && plan !== noticed.plan
        ? `The council proposes a plan: ${last.plan.summary}`
        : waiting && waiting !== noticed.waiting
          ? waitingText(sitting)
          : null;
  return {
    text,
    noticed: {
      batch: batch?.batchId ?? noticed.batch,
      plan: plan ?? noticed.plan,
      waiting: waiting ?? noticed.waiting ?? null,
    },
  };
}

/** The council waits on the user (#242): with the last thing it said, if it said anything. */
function waitingText(sitting: SittingView): string {
  const line = sitting.dialogue.at(-1);
  return line && line.speaker !== 'you'
    ? `The council is waiting on you: ${line.text}`
    : 'The council is waiting on you.';
}
