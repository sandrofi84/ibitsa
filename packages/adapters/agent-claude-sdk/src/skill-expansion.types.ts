/** What a skill's prompt becomes for a preview (#85), and anything worth knowing about it. */
export interface Expansion {
  text: string;
  /** e.g. which shell lines Claude Code runs when the action is sent. */
  notes: string[];
}

export interface ExpansionInput {
  /** The skill's prompt after its frontmatter. */
  body: string;
  /** Its frontmatter fields; `arguments` names positional arguments. */
  fields: Record<string, string>;
  /** What follows the action's name in the message. */
  args: string;
  /** Variables Claude Code fills in, e.g. CLAUDE_PROJECT_DIR. */
  variables: Record<string, string>;
}
