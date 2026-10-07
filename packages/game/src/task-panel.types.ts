/** What the rest of the game can do with the task panel (#141). */
export interface TaskPanel {
  /** Shows a task point's checks, reviews and suggestions; it follows snapshots while open. */
  open(taskPointId: string): void;
  close(): void;
  /** The task point it shows, or null when closed. */
  shown(): string | null;
}
