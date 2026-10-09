import type { Snapshot } from '@ibitsa/protocol';
import { ELDER, emptyHut } from './hut-view';
import type { HutView } from './hut-view.types';
import { councillorAppearance, councillorTitle } from './sitting-hut';

/**
 * The hut with the elder alone (#244): it walks in to welcome the user and hear the task, studies the
 * old charts while it researches, then has the floor with its brief, and again with the council's
 * approved plan. A sitting's councillors walk in to join it.
 */
export function elderHut(snapshot: Snapshot | null): HutView {
  const planning = snapshot?.campaign?.status === 'planning';
  const elder = planning ? snapshot?.elder : null;
  const approved =
    planning && snapshot?.sitting?.status === 'approved'
      ? snapshot.sitting.plans.find((p) => p.outcome.kind === 'approved')
      : undefined;
  const researching = elder?.status === 'researching';
  return {
    ...emptyHut(),
    mode: null,
    step: approved ? 'dispatch' : elder ? 'research' : 'goal',
    stage: researching ? 'study' : 'dialogue',
    councillors: [
      {
        id: ELDER,
        title: councillorTitle(ELDER),
        appearance: councillorAppearance(ELDER),
        // Before the brief the elder has nothing filed; it walks in on the welcome.
        report: elder?.status === 'briefed' || approved ? 'filed' : 'pending',
        raisedHand: false,
      },
    ],
    // It speaks once there's something to say: its brief, why it failed, or the plan.
    speaker: approved || (elder && !researching) ? ELDER : null,
    decisions: approved?.plan.decisions.length ?? 0,
  };
}
