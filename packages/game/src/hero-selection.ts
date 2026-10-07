import type { HeroView, Snapshot } from '@ibitsa/protocol';
import type { SelectionListener } from './hero-selection.types';
import type { ViewState } from './view-state';

const KEY = 'selectedHero';

/**
 * Which hero the game is looking at (§6, #125): the hero pane shows it, the command bar speaks to it
 * when no @ names another, and the map can follow it. Kept in view state, so it survives a reload. While
 * nothing valid is chosen (no choice yet, or one from an earlier campaign), it falls to the first hero
 * that needs you, else the first working one, else the first; once picked that way it stays put, so
 * the pane doesn't jump between heroes as their states change.
 */
export class HeroSelection {
  private chosen: string;
  private readonly listeners: SelectionListener[] = [];

  constructor(private readonly view: ViewState) {
    this.chosen = view.get(KEY, '');
  }

  /** The selected hero in this snapshot, or the default when the choice isn't one of its heroes. */
  selected(snapshot: Snapshot | null): HeroView | null {
    const heroes = snapshot?.heroes ?? [];
    return heroes.find((h) => h.id === this.chosen) ?? fallback(snapshot);
  }

  /** Settles the selection for a new snapshot: a missing choice becomes the default, once. */
  update(snapshot: Snapshot): void {
    if (snapshot.heroes.some((h) => h.id === this.chosen)) return;
    const hero = fallback(snapshot);
    if (hero) this.select(hero.id);
  }

  select(heroId: string): void {
    if (heroId === this.chosen) return;
    this.chosen = heroId;
    this.view.set(KEY, heroId);
    for (const listener of this.listeners) listener(heroId);
  }

  onSelect(listener: SelectionListener): void {
    this.listeners.push(listener);
  }
}

function fallback(snapshot: Snapshot | null): HeroView | null {
  if (!snapshot) return null;
  const { heroes, needsYou } = snapshot;
  return (
    heroes.find((h) => needsYou.some((i) => i.heroId === h.id)) ??
    heroes.find((h) => h.state.kind === 'working') ??
    heroes[0] ??
    null
  );
}
