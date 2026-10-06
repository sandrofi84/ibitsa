import type { ActionInfo } from '@ibitsa/protocol';
import { handles } from './at-menu';
import type { GameClient } from './client';
import type { MenuItem, MenuProvider } from './command-menu.types';
import { parseMessage } from './mentions';

const GROUPS: Record<ActionInfo['source'], string> = {
  plugin: 'Plugins',
  project: 'Project',
  user: 'Personal',
  other: 'Other',
};

/**
 * The / menu (spec §6.1, §6.2, #84): the actions Claude Code would run in the hero's folder, offered
 * for a message's first word (after the recipient, if one is named). Only actions for heroes or anyone
 * show while there's no council (M3). Ibitsa's built-ins come first, under their short names.
 */
export function slashMenu({ client }: { client: GameClient }): MenuProvider {
  return {
    trigger: '/',
    async suggest({ query, before }) {
      const snapshot = client.snapshot;
      if (snapshot?.campaign?.status !== 'active') return [];
      // Only the first word, or right after the recipient: `/test`, `@ranger-ilse /test`.
      const rest = parseMessage({ text: before, recipients: handles(snapshot.heroes) }).text;
      if (rest !== '') return [];
      const actions = await client.actionsReady();
      return actionItems({ actions, query });
    },
  };
}

/** The menu's items for a query: by name or alias, Ibitsa's own first, then the rest by source. */
export function actionItems({
  actions,
  query,
}: {
  actions: readonly ActionInfo[];
  query: string;
}): MenuItem[] {
  const q = query.toLowerCase();
  const matches = actions.filter(
    (a) =>
      a.target !== 'council' &&
      [a.name, ...a.aliases].some((name) => name.toLowerCase().includes(q)),
  );
  const ordered = [
    ...matches.filter((a) => a.name.startsWith('ibitsa:')),
    ...(['project', 'user', 'plugin', 'other'] as const).flatMap((source) =>
      matches.filter((a) => a.source === source && !a.name.startsWith('ibitsa:')),
    ),
  ];
  return ordered.map((a) => {
    const short = a.aliases[0] ?? a.name;
    const hint = a.argumentHint ? ` ${a.argumentHint}` : '';
    return {
      id: `action:${a.name}`,
      label: `/${short}${hint}`,
      detail: a.description,
      group: a.name.startsWith('ibitsa:') ? 'Ibitsa' : GROUPS[a.source],
      insert: `/${short}`,
    };
  });
}
