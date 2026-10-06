/** An action the `/` menu offers (§6.2, #84): a Claude Code skill or command the hero's folder has. */
export interface ActionInfo {
  /** What follows the slash, e.g. `pr`, or `ibitsa:test` for a plugin's. */
  name: string;
  description: string;
  /** e.g. `[reviewers]`; empty when the action takes none. */
  argumentHint: string;
  /** Other names that run it, e.g. `test` for `ibitsa:test`. */
  aliases: string[];
  /** Where it comes from: the project's skills, the user's, a plugin (Ibitsa's built-ins among them). */
  source: 'project' | 'user' | 'plugin' | 'other';
  /** `ibitsa-target` from the skill's frontmatter; `any` when absent. */
  target: 'hero' | 'council' | 'any';
}
