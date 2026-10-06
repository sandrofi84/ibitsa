/** A skill or command file as Ibitsa reads it: its frontmatter fields and its prompt text. */
export interface SkillFile {
  path: string;
  /** Flat `key: value` frontmatter fields, quotes removed. */
  fields: Record<string, string>;
  /** The prompt after the frontmatter. */
  body: string;
}

export interface SkillFilesOptions {
  /** The hero's worktree, for project skills. */
  cwd: string;
  /** The user's home, for personal skills. */
  home: string;
  /** Local plugin folders, e.g. Ibitsa's built-ins. */
  pluginDirs: readonly string[];
}
