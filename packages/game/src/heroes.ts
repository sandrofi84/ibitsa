import {
  classModelName,
  DEFAULT_CLASSES,
  type ExecutionState,
  type HeroClassView,
} from '@ibitsa/protocol';
import type { HeroClass } from './heroes.types';

/** A class as the game lists it: the protocol's view, its agent and model in words. */
function heroClass(view: HeroClassView): HeroClass {
  return {
    id: view.id,
    label: view.name,
    model: classModelName(view),
    agent: view.agent,
    modelId: view.model,
    names: view.names,
    appearance: view.appearance,
  };
}

let current: HeroClass[] = DEFAULT_CLASSES.map(heroClass);

/** The hero classes in play (§5.2, #182): the snapshot's, else the built-ins. */
export function heroClasses(): readonly HeroClass[] {
  return current;
}

/** Follows the snapshot's classes; called on every snapshot, before any panel draws. */
export function setHeroClasses(views: readonly HeroClassView[] | undefined): void {
  current = (views ?? DEFAULT_CLASSES).map(heroClass);
}

export const DEFAULT_CLASS = 'ranger';

export function defaultHeroName(classId: string): string {
  const known = current.find((c) => c.id === classId);
  return known ? `${known.label} ${known.names[0] ?? ''}`.trim() : 'Hero';
}

/** The longest speech bubble excerpt, in characters: it has to fit above a 16 px hero. */
export const SPEECH_MAX = 34;

/**
 * What a speech bubble shows of a hero's message (#57): its first sentence, without Markdown marks or
 * line breaks, cut to `SPEECH_MAX` with an ellipsis. The full text goes to the journal.
 */
export function speechExcerpt(text: string): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = plain.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? plain;
  return sentence.length <= SPEECH_MAX
    ? sentence
    : `${sentence.slice(0, SPEECH_MAX - 1).trimEnd()}…`;
}

/** Why a blocked hero is waiting (#121, #125). */
export const BLOCKED_REASONS: Record<
  Extract<ExecutionState, { kind: 'blocked' }>['reason'],
  string
> = {
  slot: 'Waiting for a free slot',
  previousIsland: 'Waiting for the island before',
  dependency: 'Waiting for a task on another island',
};

/** How a hero's state reads in the pane and the @ menu. */
export const STATE_LABELS: Record<ExecutionState['kind'], string> = {
  unknown: 'Unknown',
  error: 'Error',
  outOfGold: 'Out of gold',
  stalled: 'Stalled',
  waitingOnYou: 'Waiting on you',
  resting: 'Resting',
  working: 'Working',
  blocked: 'Blocked',
  underReview: 'Under review',
  submitted: 'Submitted',
  idle: 'Waiting for orders',
  traveling: 'Traveling',
};
