import type { GameClient } from './client';

export interface NeedsYouPanelOptions {
  client: GameClient;
  /** Opens the council's dialogue box on its waiting questions (#102). */
  openCouncil: () => void;
  /** Shows that hero in the hero pane when one of its items is clicked (#125). */
  selectHero?: (heroId: string) => void;
  /** Opens a task's checks and reviews in the task panel (#141). */
  openTask?: (taskPointId: string) => void;
}
