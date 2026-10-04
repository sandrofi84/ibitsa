/**
 * A measured value. The game must render all three cases: `?` for unknown, `~` for estimated (spec §11.2.1).
 * Never substitute a guess for `unknown`.
 */
export type Reading<T> =
  | { kind: 'exact'; value: T }
  | { kind: 'estimated'; value: T; basis: string }
  | { kind: 'unknown' };

/** Money in integer micro-dollars, converted once from the agent's float in the adapter. */
export type MicroUsd = number;

// Deliberate type error to prove CI fails (throwaway PR, never merged).
export const broken: number = 'not a number';
