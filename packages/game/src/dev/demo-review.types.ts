import type { CoreInput } from '@ibitsa/core';

export interface DemoReviewOptions {
  /** Steps an input into the live host's core, as the runtime's answer would. */
  input: (input: CoreInput) => void;
  /** The host's clock, for the inputs' `t`. */
  t: () => number;
  /** How long the checks and each review take, in ms; tests pass 0. */
  pace?: number;
}
