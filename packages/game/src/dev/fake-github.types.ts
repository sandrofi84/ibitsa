import type { CoreInput } from '@ibitsa/core';

export interface FakeGitHubOptions {
  /** Steps an input into the live host's core, as the runtime's answer would. */
  input: (input: CoreInput) => void;
  /** The host's clock, for the inputs' `t`. */
  t: () => number;
  /** How often watched PRs are polled, in ms; null polls only on Refresh. */
  pollMs?: number | null;
  /** How long a push or PR action takes, in ms; tests pass 0. */
  pace?: number;
}
