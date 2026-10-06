import type { CouncilPose } from './council-look.types';
import type { HutEvent, HutStep, HutView, Seat } from './hut-view.types';

/** The step tracker, left to right (§7.1). */
export const HUT_STEPS: readonly { step: HutStep; label: string }[] = [
  { step: 'goal', label: 'Goal' },
  { step: 'research', label: 'Research' },
  { step: 'questions', label: 'Questions' },
  { step: 'plan', label: 'Plan' },
  { step: 'dispatch', label: 'Dispatch' },
];

/** Registry key: the feed the hut scene renders from (`Started.showHut`). */
export const HUT_FEED = 'hutFeed';

/** The elder chairs the table, and writes in the Book of Decisions while the plan is drawn up. */
export const ELDER = 'elder';

export const emptyHut = (): HutView => ({
  mode: 'roundTable',
  step: 'goal',
  stage: 'dialogue',
  councillors: [],
  speaker: null,
  decisions: 0,
});

/** The view after one event; unknown councillors are ignored. */
export function reduceHut(view: HutView, event: HutEvent): HutView {
  switch (event.type) {
    case 'convened':
      return {
        ...emptyHut(),
        mode: event.mode,
        stage: event.mode === 'chambers' ? 'study' : 'dialogue',
        councillors: event.councillors.map((c) => ({ ...c, report: 'pending', raisedHand: false })),
      };
    case 'reportFiled': {
      const councillors = view.councillors.map((c) =>
        c.id === event.councillor ? { ...c, report: 'filed' as const } : c,
      );
      const allIn = councillors.every((c) => c.report === 'filed');
      return {
        ...view,
        councillors,
        stage: view.stage === 'study' && allIn ? 'dialogue' : view.stage,
      };
    }
    case 'speaking':
      return {
        ...view,
        speaker: event.councillor,
        // Being given the floor lowers the hand.
        councillors: view.councillors.map((c) =>
          c.id === event.councillor ? { ...c, raisedHand: false } : c,
        ),
      };
    case 'handRaised':
      return {
        ...view,
        councillors: view.councillors.map((c) =>
          c.id === event.councillor ? { ...c, raisedHand: event.raised } : c,
        ),
      };
    case 'step':
      return { ...view, step: event.step };
    case 'decisionRecorded':
      return { ...view, decisions: view.decisions + 1 };
  }
}

/** What a councillor is doing: speaking beats a raised hand, which beats studying or writing. */
export function councilPose(view: HutView, id: string): CouncilPose {
  const c = view.councillors.find((x) => x.id === id);
  if (!c) return 'idle';
  if (view.speaker === id) return 'talk';
  if (c.raisedHand) return 'raiseHand';
  if (view.stage === 'study' && c.report === 'pending') return 'think';
  if (id === ELDER && view.step === 'plan') return 'write';
  return 'idle';
}

/** Seats along the table in a room `width` wide, the elder in the middle, the others either side in order. */
export function seatHut(view: HutView, width: number): Seat[] {
  const others = view.councillors.filter((c) => c.id !== ELDER).map((c) => c.id);
  const hasElder = others.length < view.councillors.length;
  const half = Math.ceil(others.length / 2);
  const order = hasElder ? [...others.slice(0, half), ELDER, ...others.slice(half)] : others;
  const spacing = Math.min(64, Math.floor((width - 80) / Math.max(1, order.length)));
  const middle = (order.length - 1) / 2;
  return order.map((id, i) => ({ id, x: Math.round(width / 2 + (i - middle) * spacing) }));
}
