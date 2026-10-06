/** What the rest of the game can do with the New Quest form. */
export interface NewQuestForm {
  /** Opens it, optionally with the task already written (from the command bar, #81). */
  open(prefill?: { description: string }): void;
  /** Opens it for a quick quest after the elder's brief: the task written, the hero's fields shown. */
  quickQuest(task: string): void;
}
