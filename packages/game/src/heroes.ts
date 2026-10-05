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
