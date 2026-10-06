import type { RuntimeHost } from './runtime-host';

export interface RunActionOptions {
  host: RuntimeHost | null;
  /** Skips the prompts (integration tests): the action's name and its arguments. */
  picked?: { name: string; args: string } | undefined;
  /** Opens the game tab. */
  open: () => void;
}
