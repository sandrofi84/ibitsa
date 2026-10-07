import * as v from 'valibot';
import { ClassesSettingSchema, type RecolorMap, RecolorMapSchema } from './classes.schema';
import type { HeroClassView } from './classes.types';

/** The classes Ibitsa ships with (§5.2). */
export const DEFAULT_CLASSES: readonly HeroClassView[] = [
  {
    id: 'paladin',
    name: 'Paladin',
    model: 'fable',
    appearance: 'hero.paladin',
    names: ['Aldric', 'Seraphine', 'Tamsin'],
    builtIn: true,
  },
  {
    id: 'barbarian',
    name: 'Barbarian',
    model: 'opus',
    appearance: 'hero.barbarian',
    names: ['Brann', 'Hilda', 'Torvald'],
    builtIn: true,
  },
  {
    id: 'ranger',
    name: 'Ranger',
    model: 'sonnet',
    appearance: 'hero.ranger',
    names: ['Ilse', 'Rowan', 'Wren'],
    builtIn: true,
  },
  {
    id: 'rogue',
    name: 'Rogue',
    model: 'haiku',
    appearance: 'hero.rogue',
    names: ['Vex', 'Nim', 'Sable'],
    builtIn: true,
  },
];

/** Model aliases in words, for the class lists. */
const MODEL_NAMES: Record<string, string> = {
  fable: 'Claude Fable',
  opus: 'Claude Opus',
  sonnet: 'Claude Sonnet',
  haiku: 'Claude Haiku',
};

/** A model alias in words (`opus` → Claude Opus); a full id as it is. */
export function modelName(model: string): string {
  return MODEL_NAMES[model] ?? model;
}

/**
 * The classes in play (§5.2, #182): the built-ins with `ibitsa.classes` laid over them by id, then the
 * classes it adds. A setting that doesn't check out is ignored, so a typo can't hide every class.
 */
export function resolveClasses(setting: unknown): HeroClassView[] {
  const parsed = v.safeParse(ClassesSettingSchema, setting ?? {});
  const configured = parsed.success ? parsed.output : {};
  const classes = DEFAULT_CLASSES.map((c) => ({ ...c, names: [...c.names] }));
  for (const [id, s] of Object.entries(configured)) {
    const known = classes.find((c) => c.id === id);
    const merged: HeroClassView = {
      id,
      name: s.name ?? known?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
      model: s.model ?? known?.model ?? 'sonnet',
      appearance: s.appearance ?? known?.appearance ?? 'hero.ranger',
      names: s.names ?? known?.names ?? [],
      builtIn: known?.builtIn ?? false,
    };
    if (known) classes.splice(classes.indexOf(known), 1, merged);
    else classes.push(merged);
  }
  return classes;
}

/** `ibitsa.recolor`, checked entry by entry: one that doesn't check out is dropped alone. */
export function resolveRecolor(setting: unknown): RecolorMap {
  if (!setting || typeof setting !== 'object') return {};
  const map: RecolorMap = {};
  for (const [target, value] of Object.entries(setting)) {
    const one = v.safeParse(RecolorMapSchema, { [target]: value });
    if (one.success) Object.assign(map, one.output);
  }
  return map;
}
