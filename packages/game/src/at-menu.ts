import { type HeroView, heroHandle } from '@ibitsa/protocol';
import type { GameClient } from './client';
import type { MenuItem, MenuProvider } from './command-menu.types';
import { rankPaths } from './file-search';
import { STATE_LABELS } from './heroes';
import { ALL, addressedHero, COUNCIL, councilHandles, parseMessage } from './mentions';
import { councillorTitle } from './sitting-hut';

/**
 * The @ menu (spec §6.1, #83). Recipients first: the hero by its handle, with its state, and `@all`;
 * only while no recipient is named yet and only where the input chooses one (the command bar, not the
 * hero pane's box). Then files in the recipient's worktree, inserted as `@path` for the hero to read.
 */
export function atMenu({
  client,
  recipients,
  selected = () => null,
}: {
  client: GameClient;
  /** False in the hero pane: its box always speaks to that hero. */
  recipients: boolean;
  /** The hero a message goes to when no @ names one (#125). */
  selected?: () => string | null;
}): MenuProvider {
  return {
    trigger: '@',
    async suggest({ query, before }) {
      const snapshot = client.snapshot;
      if (snapshot?.campaign?.status !== 'active') return [];
      const heroes = snapshot.heroes;
      const council = councilHandles(snapshot);
      const named = parseMessage({
        text: before,
        recipients: [...handles(heroes), ...council],
      }).recipient;
      const items: MenuItem[] = [];
      if (recipients && !named) {
        items.push(...recipientItems({ heroes, query }), ...councilItems({ council, query }));
      }
      // The council reads no worktree: no files after @council or a councillor.
      if (named && council.includes(named)) return items;
      const hero = addressedHero({ text: before, heroes, selected: selected() });
      const island = snapshot.islands.find((i) => i.id === hero?.islandId);
      if (island?.worktree === 'ready') {
        const paths = await client.files(island.id);
        for (const path of rankPaths({ paths, query })) {
          items.push({ id: `file:${path}`, label: path, group: 'Files', insert: `@${path}` });
        }
      }
      return items;
    },
  };
}

/** Every recipient handle: each hero's, and `all`. */
export function handles(heroes: readonly HeroView[]): string[] {
  return [...heroes.map((h) => heroHandle(h.name)), ALL];
}

function recipientItems({
  heroes,
  query,
}: {
  heroes: readonly HeroView[];
  query: string;
}): MenuItem[] {
  const q = query.toLowerCase();
  const items: MenuItem[] = heroes.map((hero) => {
    const handle = heroHandle(hero.name);
    return {
      id: `recipient:${handle}`,
      label: `@${handle}`,
      detail: `${hero.name} · ${STATE_LABELS[hero.state.kind]}`,
      group: 'Recipients',
      insert: `@${handle}`,
    };
  });
  items.push({
    id: `recipient:${ALL}`,
    label: `@${ALL}`,
    detail: 'Every hero',
    group: 'Recipients',
    insert: `@${ALL}`,
  });
  return items.filter((item) => item.label.slice(1).startsWith(q));
}

/** `@council` and each councillor who sat, once the council can be asked mid-campaign (#169). */
function councilItems({ council, query }: { council: string[]; query: string }): MenuItem[] {
  const q = query.toLowerCase();
  return council
    .map((handle) => ({
      id: `recipient:${handle}`,
      label: `@${handle}`,
      detail: handle === COUNCIL ? 'Ask the whole council' : `Ask ${councillorTitle(handle)}`,
      group: 'Council',
      insert: `@${handle}`,
    }))
    .filter((item) => item.label.slice(1).startsWith(q));
}
