/** A councillor the council can seat (§4.7, #98): a skill marked `ibitsa-councillor: true`. */
export interface CouncillorInfo {
  /** The skill's own name without a plugin prefix, e.g. `security`; a project's replaces a built-in's. */
  id: string;
  /** The name Claude Code knows it by, e.g. `ibitsa:security` for a built-in. */
  skill: string;
  /** What the game calls it: `ibitsa-title`, else the id capitalised, e.g. `Security`. */
  title: string;
  description: string;
  /** Where it comes from: the project's skills, the user's, or Ibitsa's built-ins. */
  source: 'project' | 'user' | 'builtin';
  /** `ibitsa-portrait`: a character id in the art pack; null for the default councillor's. */
  portrait: string | null;
  /** `ibitsa-model`: a model alias or id; null lets the effort decide. */
  model: string | null;
  /** `ibitsa-tools`, kept to the read-only tools a sitting allows; `Read`, `Grep`, `Glob` when absent. */
  tools: string[];
  /** Which sections its skill has: `## Planning` and `## Review`. */
  modes: { planning: boolean; review: boolean };
  /** A short hash of the skill file, so a changed councillor gives a new council version (§4.10). */
  hash: string;
}
