import type { CouncilPose } from './council-look.types';
import type { HutEvent, HutStep, HutView, Seat, WalkIn, WalkInPlan } from './hut-view.types';

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

/** How wide a council figure is (§9.2): seats are this far apart once the table is full. */
export const FIGURE_WIDTH = 48;

/**
 * Seats along the table in a room `width` wide, the elder in the middle, the others either side in
 * order. Nine 48-wide figures fill the table shoulder to shoulder (#219); fewer stand further apart.
 */
export function seatHut(view: HutView, width: number): Seat[] {
  const others = view.councillors.filter((c) => c.id !== ELDER).map((c) => c.id);
  const hasElder = others.length < view.councillors.length;
  const half = Math.ceil(others.length / 2);
  const order = hasElder ? [...others.slice(0, half), ELDER, ...others.slice(half)] : others;
  const spacing = Math.min(64, Math.floor((width - FIGURE_WIDTH) / Math.max(1, order.length)));
  const middle = (order.length - 1) / 2;
  return order.map((id, i) => ({ id, x: Math.round(width / 2 + (i - middle) * spacing) }));
}

/** Where councillors come in: the hut's door, on the left (#219). */
export const HUT_DOOR_X = 16;
/** How fast a councillor walks in, in pixels a second, and the gap between two coming in together. */
const WALK_SPEED = 160;
const WALK_STAGGER_MS = 250;

/** Whether a sitting has only just convened: its first step, nothing studied, said or decided yet. */
const justConvened = (view: HutView) =>
  view.step === 'goal' &&
  view.decisions === 0 &&
  view.speaker === null &&
  view.councillors.every((c) => c.report === 'pending' && !c.raisedHand);

/**
 * Who walks in through the door to their seat (#219), when, and for how long: the councillors new
 * to the table since the last view. On the scene's first view they walk in only when the sitting
 * has just convened; a hut opened mid-sitting, or reopened, shows everyone already seated. Nobody
 * walks with reduced motion. The farthest walks first, so nobody crosses a seated councillor.
 */
export function walkIns({ seats, seated, first, view, reducedMotion }: WalkInPlan): WalkIn[] {
  if (reducedMotion || (first && !justConvened(view))) return [];
  return seats
    .filter((s) => !seated.has(s.id))
    .sort((a, b) => b.x - a.x)
    .map((s, i) => ({
      id: s.id,
      fromX: HUT_DOOR_X,
      toX: s.x,
      delayMs: i * WALK_STAGGER_MS,
      durationMs: Math.round((Math.abs(s.x - HUT_DOOR_X) / WALK_SPEED) * 1000),
    }));
}
