// The council hut's own view model. The hut renders only this, so wiring it to the sitting's
// protocol events (#100) is a mapping onto `HutEvent`s.

export type HutMode = 'roundTable' | 'chambers';
export type HutStep = 'goal' | 'research' | 'questions' | 'plan' | 'dispatch';

export interface HutCouncillor {
  id: string;
  title: string;
  /** Pack character key, e.g. `councillor.elder`. */
  appearance: string;
  report: 'pending' | 'filed';
  raisedHand: boolean;
}

export interface HutView {
  mode: HutMode;
  step: HutStep;
  /** Separate chambers start by studying until every report is in; a round table goes straight to dialogue. */
  stage: 'study' | 'dialogue';
  councillors: HutCouncillor[];
  speaker: string | null;
  decisions: number;
}

export type HutEvent =
  | {
      type: 'convened';
      mode: HutMode;
      councillors: Pick<HutCouncillor, 'id' | 'title' | 'appearance'>[];
    }
  | { type: 'reportFiled'; councillor: string }
  | { type: 'speaking'; councillor: string | null }
  | { type: 'handRaised'; councillor: string; raised: boolean }
  | { type: 'step'; step: HutStep }
  | { type: 'decisionRecorded' };

/** Where the hut's view comes from: a scripted sitting now, the real sitting from #100 later. */
export interface HutFeed {
  readonly view: HutView;
  onChange(listener: (view: HutView) => void): () => void;
}

export interface Seat {
  id: string;
  x: number;
}

/** A councillor walking in from the hut's door to their seat (#219). */
export interface WalkIn {
  id: string;
  fromX: number;
  toX: number;
  /** After the walk-ins before it, so several coming in together don't overlap. */
  delayMs: number;
  durationMs: number;
}

/** What decides who walks in: the seats now, who already stands at one, and the scene's state. */
export interface WalkInPlan {
  seats: readonly Seat[];
  seated: ReadonlySet<string>;
  /** The scene's first view since it opened. */
  first: boolean;
  view: HutView;
  reducedMotion: boolean;
}

/** Placing the councillors' name plates on the table's front (#233). */
export interface NamePlateInput {
  seats: readonly Seat[];
  /** Each seat's title as measured in the scene's font, in seat order. */
  widths: readonly number[];
  /** How wide the room is: a plate never leaves it. */
  room: number;
}

/** A councillor's name plate: centred at `x`, `y`, and `width` wide. */
export interface NamePlate {
  id: string;
  x: number;
  y: number;
  width: number;
}

/** Shortening a title to fit a plate, measured in the scene's font (#233). */
export interface TitleFit {
  title: string;
  measure: (text: string) => number;
}
