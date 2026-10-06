import type { GameClient } from './client';
import type { CommandHistory } from './command-history';

export interface CommandBarOptions {
  client: GameClient;
  history: CommandHistory;
  onHistoryChange: () => void;
  /** With no quest running, Enter offers to start one with the text as its task (#81). */
  startQuest: (description: string) => void;
  /** Opens the New action form, offered at the end of the / menu (#86). */
  newAction?: () => void;
}

export interface CommandBar {
  /** Puts the keyboard in the bar, e.g. from the Command Palette (#87). */
  focus(): void;
  /** Writes `text` into the bar (its preview follows) and focuses it, e.g. "Run Action…" (#87). */
  fill(text: string): void;
}
