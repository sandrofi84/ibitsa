export interface CommandHistoryOptions {
  /** Earlier messages, oldest first. */
  entries?: string[];
  /** How many to keep. */
  limit?: number;
}
