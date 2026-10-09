import type { GameClient } from './client';

export interface NeedsYouPanelOptions {
  client: GameClient;
  /** Opens the council's dialogue box on its waiting questions (#102). */
  openCouncil: () => void;
  /** Takes the user to where they tell the council something, when it waits on them (#242). */
  replyToCouncil?: () => void;
  /** Shows that hero in the hero pane when one of its items is clicked (#125). */
  selectHero?: (heroId: string) => void;
  /** Opens a task's checks and reviews in the task panel (#141). */
  openTask?: (taskPointId: string) => void;
  /** Brings the council's waiting amendment into view (#170). */
  reviewAmendment?: () => void;
  /** Opens the party assembly of an island an amendment added (#170). */
  assembleParty?: (islandId: string) => void;
}
