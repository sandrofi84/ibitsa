import type { CouncilPose } from './council-look.types';
import type {
  HutEvent,
  HutStep,
  HutView,
  NamePlate,
  NamePlateInput,
  Seat,
  StatusMark,
  StatusQuery,
  TitleFit,
  WalkIn,
  WalkInPlan,
} from './hut-view.types';

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

/** Game event: everyone at the table is in their seat, no one still walking in (#244). */
export const HUT_SEATED = 'hutSeated';

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

/** The thinking dots, growing one at a time. */
const STUDY_DOTS = ['•', '••', '•••'];

/** A councillor's thought bubble while the chambers study (#267): dots, then ✓; none otherwise. */
export function statusMark({ view, id, dots }: StatusQuery): StatusMark | null {
  const c = view.councillors.find((x) => x.id === id);
  if (view.stage !== 'study' || !c) return null;
  if (c.report === 'filed') return { text: '✓', done: true };
  return { text: STUDY_DOTS[dots % STUDY_DOTS.length] as string, done: false };
}

/** How many steps the thinking dots take before starting again. */
export const STUDY_DOT_STEPS = STUDY_DOTS.length;

/**
 * The status bubbles' colours (#267): dark marks on a light bubble with a dark rim, so a bubble reads
 * against any room a pack paints: the fill stands out from a dark wall, the rim from a light one.
 */
export const STATUS_BUBBLE = {
  fill: '#fdfaf0',
  rim: '#1a1420',
  ink: '#1a1420',
  done: '#1f7a34',
} as const;

/** WCAG's contrast ratio between two `#rrggbb` colours: 1 (none) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG's relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
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

/** The table's top edge (§9.2, #219): councillors stand behind it, hidden from it down. */
export const TABLE_TOP = 176;

/**
 * The name plates' rows, on the table's front panel (#233): below its top, where a pack's table may
 * draw the Book of Decisions, a candle or an inkwell, and plain wood in the game's own table too.
 */
export const NAME_ROWS = [TABLE_TOP + 24, TABLE_TOP + 38] as const;
/** The "Book of Decisions" counter's plate, under the names. */
export const DECISIONS_Y = TABLE_TOP + 54;
/** A plate's padding either side of its title, and the least gap between two plates on a row. */
export const PLATE_PAD = 3;
export const PLATE_GAP = 4;
/** The widest a plate may be; a longer title is shortened to fit (`fitTitle`). */
export const PLATE_MAX = 92;

/**
 * Where each councillor's name plate goes (#233): centred under their seat on the first row, or,
 * when any two neighbours' plates would touch, every other plate on the second row. A plate never
 * leaves the room.
 */
export function placeNames({ seats, widths, room }: NamePlateInput): NamePlate[] {
  const plates = seats.map((_, i) => Math.min(PLATE_MAX, (widths[i] ?? 0) + 2 * PLATE_PAD));
  const crowded = seats.some((seat, i) => {
    const next = seats[i + 1];
    if (!next) return false;
    const half = ((plates[i] ?? 0) + (plates[i + 1] ?? 0)) / 2;
    return next.x - seat.x < half + PLATE_GAP;
  });
  return seats.map((seat, i) => {
    const width = plates[i] ?? 0;
    const x = Math.min(room - width / 2 - 2, Math.max(width / 2 + 2, seat.x));
    const y = crowded && i % 2 === 1 ? NAME_ROWS[1] : NAME_ROWS[0];
    return { id: seat.id, x: Math.round(x), y, width: Math.round(width) };
  });
}

/** A title that fits a plate (#233): as it is, or cut with an ellipsis. */
export function fitTitle({ title, measure }: TitleFit): string {
  const room = PLATE_MAX - 2 * PLATE_PAD;
  if (measure(title) <= room) return title;
  let cut = title;
  while (cut.length > 1 && measure(`${cut}…`) > room) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}
