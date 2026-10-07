import { type Plan, planIslands } from '@ibitsa/protocol';
import { DEFAULT_CLASS, HERO_CLASSES } from './heroes';
import type { CapInput, PartyRow } from './parties.types';

/**
 * Party assembly's rows (§7.1 screen 4, #123): one per plan island, its hero's class from the island's
 * first task's suggestion, a name no other row has, and the councillors who wrote criteria for its tasks.
 */
export function partyRows(plan: Plan): PartyRow[] {
  const tasks = new Map(plan.tasks.map((t) => [t.id, t]));
  const taken: string[] = [];
  return planIslands(plan).islands.map((island) => {
    const own = island.tasks.flatMap((id) => {
      const task = tasks.get(id);
      return task ? [task] : [];
    });
    const classId = own[0]?.heroClass ?? DEFAULT_CLASS;
    const heroName = heroNameFor({ classId, taken });
    taken.push(heroName);
    const councillors = [...new Set(own.flatMap((t) => t.criteria.map((c) => c.councillorId)))];
    return {
      islandId: island.id,
      title: island.title,
      tasks: own.map((t) => t.title),
      classId,
      heroName,
      councillors,
    };
  });
}

/** A class's next default name that no other party has: `Ranger Ilse`, then `Ranger Rowan`… */
export function heroNameFor({
  classId,
  taken,
}: {
  classId: string;
  taken: readonly string[];
}): string {
  const heroClass = HERO_CLASSES.find((c) => c.id === classId);
  const label = heroClass?.label ?? 'Hero';
  const names = heroClass?.names.map((n) => `${label} ${n}`) ?? [label];
  const free = names.find((n) => !taken.includes(n));
  if (free) return free;
  for (let n = 2; ; n++) {
    const name = `${names[0]} ${n}`;
    if (!taken.includes(name)) return name;
  }
}

/** A typed gold cap: empty keeps the default pouch, "no cap" none, otherwise dollars above zero. */
export function capFromInput({ text, noCap }: { text: string; noCap: boolean }): CapInput {
  if (noCap) return { ok: true, budgetMicroUsd: null };
  const trimmed = text.trim().replace(/^\$/, '');
  if (trimmed === '') return { ok: true, budgetMicroUsd: undefined };
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars <= 0) {
    return { ok: false, problem: `"${text.trim()}" isn't an amount of dollars.` };
  }
  return { ok: true, budgetMicroUsd: Math.round(dollars * 1_000_000) };
}

/** The first problem with the parties' names: empty or used twice. */
export function namesProblem(names: readonly string[]): string | undefined {
  if (names.some((n) => n.trim() === '')) return 'Every hero needs a name.';
  const twice = names.find((n, i) => names.findIndex((m) => m.trim() === n.trim()) !== i);
  return twice ? `Two heroes are called ${twice.trim()}.` : undefined;
}
