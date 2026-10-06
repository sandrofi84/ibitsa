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
