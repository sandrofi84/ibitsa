/** The Guild Hall's tabs (§7.1, #179); the Roster, Armory and Packs join with their own issues. */
export type GuildTab = 'rules' | 'spells' | 'chronicle';

/** What the rest of the game can do with the Guild Hall. */
export interface GuildHall {
  open(tab?: GuildTab): void;
  close(): void;
  /** The tab it shows, or null when closed. */
  shown(): GuildTab | null;
}
