export interface CommandResult {
  ok: boolean;
  /** stdout and stderr together, trimmed. */
  output: string;
}
