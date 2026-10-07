/** The Guild Hall's tabs (§7.1, #179, #181, #182). */
export type GuildTab = 'roster' | 'rules' | 'armory' | 'spells' | 'chronicle' | 'packs';

/** What the rest of the game can do with the Guild Hall. */
export interface GuildHall {
  open(tab?: GuildTab): void;
  close(): void;
  /** The tab it shows, or null when closed. */
  shown(): GuildTab | null;
}
