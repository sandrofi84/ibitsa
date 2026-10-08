/**
 * Whether heroes of a class can set out (§11.5, #199), and what to show about it. A Claude class needs
 * no check and is always ready, with nothing to show.
 */
export interface ClassReadiness {
  ready: boolean;
  /** The agent's state in words: checking, ready, not installed, needs a sign-in, model not offered. */
  text: string | null;
  /** Shown beside a ready class, e.g. that the gold pouch can't stop its heroes. */
  warning: string | null;
  /** The agent to sign in to, when Sign in can open a terminal on it. */
  signIn: string | null;
  /** The agent to check again, when that might change the answer. */
  recheck: string | null;
}

/** The party check as the game's panels use it: one store for every panel (#199). */
export interface PartyCheck {
  /** Starts checking the ACP agents of these classes (not those already being checked). */
  check(classIds: readonly string[]): void;
  /** What the class's agent's last check says, or that it's being checked. */
  readiness(classId: string): ClassReadiness;
  /** Every class ready to set out. */
  allReady(classIds: readonly string[]): boolean;
  /** Opens a terminal on the agent's sign-in, through the extension. */
  signIn(agent: string): void;
  /** Checks the agent again, without the extension's recent answer. */
  recheck(agent: string): void;
  /** Called on every new answer; returns how to stop. */
  onChange(listener: () => void): () => void;
}
