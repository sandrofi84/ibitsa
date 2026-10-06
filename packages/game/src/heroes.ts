import type { ExecutionState } from '@ibitsa/protocol';
import type { HeroClass } from './heroes.types';

/** The default hero classes (spec §5.2). Remapping and new classes come with M8. */
export const HERO_CLASSES: HeroClass[] = [
  {
    id: 'paladin',
    label: 'Paladin',
    model: 'Claude Fable',
    names: ['Aldric', 'Seraphine', 'Tamsin'],
  },
  {
    id: 'barbarian',
    label: 'Barbarian',
    model: 'Claude Opus',
    names: ['Brann', 'Hilda', 'Torvald'],
  },
  { id: 'ranger', label: 'Ranger', model: 'Claude Sonnet', names: ['Ilse', 'Rowan', 'Wren'] },
  { id: 'rogue', label: 'Rogue', model: 'Claude Haiku', names: ['Vex', 'Nim', 'Sable'] },
];

export const DEFAULT_CLASS = 'ranger';

export function defaultHeroName(classId: string): string {
  const heroClass = HERO_CLASSES.find((c) => c.id === classId);
  return heroClass ? `${heroClass.label} ${heroClass.names[0]}` : 'Hero';
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
  submitted: 'Submitted',
  idle: 'Waiting for orders',
  traveling: 'Traveling',
};
