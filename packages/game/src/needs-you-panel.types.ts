import type { GameClient } from './client';

export interface NeedsYouPanelOptions {
  client: GameClient;
  /** Opens the council's dialogue box on its waiting questions (#102). */
  openCouncil: () => void;
}
