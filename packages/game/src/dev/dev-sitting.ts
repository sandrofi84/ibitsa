// A scripted sitting for the standalone game: drives the council hut until the real sitting
// events arrive with #100. `?scene=hut&mode=chambers|roundTable`, `&crowd=1` for a full table of nine.
import { emptyHut, reduceHut } from '../hut-view';
import type { HutEvent, HutFeed, HutMode, HutView } from '../hut-view.types';

const ROSTER = [
  { id: 'elder', title: 'Elder', appearance: 'councillor.elder' },
  { id: 'architect', title: 'Architect', appearance: 'councillor.default' },
  { id: 'tester', title: 'Tester', appearance: 'councillor.default' },
  { id: 'accessibility', title: 'Accessibility', appearance: 'councillor.default' },
  { id: 'security', title: 'Security', appearance: 'councillor.default' },
  { id: 'designer', title: 'Designer', appearance: 'councillor.default' },
];

/** Three more, so a crowded sitting fills the table with nine (#219). */
const CROWD = [
  { id: 'navigator', title: 'Navigator', appearance: 'councillor.default' },
  { id: 'scribe', title: 'Scribe', appearance: 'councillor.default' },
  { id: 'herald', title: 'Herald', appearance: 'councillor.default' },
];

/** The sitting's events in order: reports (studied first in separate chambers), questions, the plan. */
export function sittingScript(mode: HutMode, crowd = false): HutEvent[] {
  return [
    { type: 'convened', mode, councillors: crowd ? [...ROSTER, ...CROWD] : ROSTER },
    { type: 'step', step: 'research' },
    ...['tester', 'designer', 'elder', 'architect', 'accessibility', 'security'].map(
      (councillor): HutEvent => ({ type: 'reportFiled', councillor }),
    ),
    { type: 'step', step: 'questions' },
    { type: 'handRaised', councillor: 'security', raised: true },
    { type: 'speaking', councillor: 'security' },
    { type: 'handRaised', councillor: 'architect', raised: true },
    { type: 'speaking', councillor: 'tester' },
    { type: 'decisionRecorded' },
    { type: 'speaking', councillor: 'architect' },
    { type: 'decisionRecorded' },
    { type: 'speaking', councillor: null },
    { type: 'step', step: 'plan' },
    { type: 'speaking', councillor: 'elder' },
    { type: 'speaking', councillor: null },
    { type: 'step', step: 'dispatch' },
  ];
}

export class ScriptedSitting implements HutFeed {
  private current: HutView = emptyHut();
  private next = 0;
  private readonly script: HutEvent[];
  private readonly listeners = new Set<(view: HutView) => void>();

  constructor(mode: HutMode, crowd = false) {
    this.script = sittingScript(mode, crowd);
    this.advance();
  }

  get view(): HutView {
    return this.current;
  }

  onChange(listener: (view: HutView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Applies the next event; false once the script has ended. */
  advance(): boolean {
    const event = this.script[this.next];
    if (!event) return false;
    this.next += 1;
    this.current = reduceHut(this.current, event);
    for (const listener of this.listeners) listener(this.current);
    return true;
  }
}
