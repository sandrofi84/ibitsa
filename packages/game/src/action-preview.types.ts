import type { GameClient } from './client';
import type { CommandInput } from './command-input.types';

export interface ActionPreviewOptions {
  client: GameClient;
  input: CommandInput;
  /** Recipient handles a message may start with, e.g. `ranger-ilse` (#83). */
  recipients: () => string[];
}
