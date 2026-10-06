import type { CouncillorInfo, SittingStatus, SittingView } from '@ibitsa/protocol';
import { ELDER, emptyHut } from './hut-view';
import type { HutCouncillor, HutFeed, HutStep, HutView } from './hut-view.types';
import type { SittingFocus } from './sitting-hut.types';

/** While the council sits the hut shows; once the sitting ends the map comes back. */
const SITTING: readonly SittingStatus[] = ['convening', 'deliberating', 'awaitingApproval'];

export function isSitting(sitting: SittingView | null | undefined): sitting is SittingView {
  return sitting != null && SITTING.includes(sitting.status);
}

/** The workspace's councillors from the last snapshot (#103): their titles and portraits. */
const known = new Map<string, CouncillorInfo>();

/** Keeps the snapshot's councillor list, so titles and portraits follow the skill files. */
export function rememberCouncillors(list: readonly CouncillorInfo[] | undefined): void {
  if (!list) return;
  known.clear();
  for (const c of list) known.set(c.id, c);
}

/** A councillor's title from its skill, else from its id: `api-design` → `Api design`. */
export function councillorTitle(id: string): string {
  if (id === ELDER) return 'Elder';
  const title = known.get(id)?.title;
  if (title) return title;
  const words = id.replaceAll('-', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The pack character a councillor is drawn with: its `ibitsa-portrait`, else the default. */
export function councillorAppearance(id: string): string {
  if (id === ELDER) return 'councillor.elder';
  return known.get(id)?.portrait ?? 'councillor.default';
}

/**
 * The hut's view of a real sitting (#102): the elder chairs, the roster sits either side, the asking
 * councillor has the floor and the others with questions in the batch raise their hands.
 */
export function hutFromSitting({ sitting, focus }: SittingFocus): HutView {
  const items = sitting.questions?.items ?? [];
  const focused = items.find((q) => q.id === focus);
  const lastSpeaker = sitting.dialogue.at(-1)?.speaker;
  const speaker =
    focused?.councillorId ??
    (sitting.status === 'awaitingApproval'
      ? ELDER
      : lastSpeaker && lastSpeaker !== 'you'
        ? lastSpeaker
        : null);
  const asking = new Set(items.map((q) => q.councillorId));
  const councillors: HutCouncillor[] = [
    {
      id: ELDER,
      title: councillorTitle(ELDER),
      appearance: councillorAppearance(ELDER),
      report: 'filed',
      raisedHand: false,
    },
    ...sitting.roster.map(
      (c): HutCouncillor => ({
        id: c.councillorId,
        title: councillorTitle(c.councillorId),
        appearance: councillorAppearance(c.councillorId),
        report: c.reported ? 'filed' : 'pending',
        raisedHand: asking.has(c.councillorId) && c.councillorId !== speaker,
      }),
    ),
  ];
  const allIn = sitting.roster.every((c) => c.reported);
  const studying = sitting.mode === 'chambers' && !allIn && items.length === 0;
  return {
    ...emptyHut(),
    mode: sitting.mode,
    step: stepOf({ sitting, allIn }),
    stage: studying ? 'study' : 'dialogue',
    councillors,
    speaker,
  };
}

function stepOf({ sitting, allIn }: { sitting: SittingView; allIn: boolean }): HutStep {
  if (sitting.status === 'convening') return 'goal';
  if (sitting.status === 'awaitingApproval') return 'plan';
  if (sitting.status === 'approved') return 'dispatch';
  return sitting.questions || allIn ? 'questions' : 'research';
}

/** The hut's feed from snapshots: a new view only when what it shows changes. */
export class SittingFeed implements HutFeed {
  private current: HutView = emptyHut();
  private key = '';
  private readonly listeners = new Set<(view: HutView) => void>();

  get view(): HutView {
    return this.current;
  }

  onChange(listener: (view: HutView) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  update(input: SittingFocus): void {
    const next = hutFromSitting(input);
    const key = JSON.stringify(next);
    if (key === this.key) return;
    this.key = key;
    this.current = next;
    for (const listener of this.listeners) listener(next);
  }
}
