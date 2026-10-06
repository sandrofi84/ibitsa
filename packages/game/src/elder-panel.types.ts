/** What the elder panel needs from the rest of the game. */
export interface ElderPanelOptions {
  /** Opens the New Quest form for a quick quest with this task (spec §4.1). */
  quickQuest: (task: string) => void;
  /** Opens the convene form (spec §4.2). */
  convene: () => void;
}
