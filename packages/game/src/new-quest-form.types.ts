/** What the rest of the game can do with the New Quest form. */
export interface NewQuestForm {
  /** Opens it, optionally with the task already written (from the command bar, #81). */
  open(prefill?: { description: string }): void;
  /** Opens it for a quick quest after the elder's brief: the task written, the hero's fields shown. */
  quickQuest(task: string): void;
  /**
   * Runs `then` once the extension has credentials, showing the first-run API-key card first if it
   * hasn't (party assembly, #123).
   */
  withCredentials(then: () => void): void;
}
