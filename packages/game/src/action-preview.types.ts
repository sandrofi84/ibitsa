import type { GameClient } from './client';
import type { CommandInput } from './command-input.types';

export interface ActionPreviewOptions {
  client: GameClient;
  input: CommandInput;
  /** Recipient handles a message may start with, e.g. `ranger-ilse` (#83). */
  recipients: () => string[];
  /** The hero a message goes to when no @ names one: its worktree expands the action (#125). */
  selected?: () => string | null;
}
