import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * "Always allow in this project" rules (#62): kept by Ibitsa in workspace storage, one list per
 * repository, and passed to every hero session. Claude Code's own settings files are not touched: hero
 * sessions run in worktrees, which never get the repo's git-ignored `settings.local.json`.
 */
export class ProjectRules {
  private readonly path: string;
  private rules: string[];

  constructor(storageDir: string) {
    this.path = join(storageDir, 'project-rules.json');
    this.rules = read(this.path);
  }

  list(): string[] {
    return [...this.rules];
  }

  /** Adds the rules not already there; returns true when the list changed. */
  add(rules: string[]): boolean {
    const fresh = rules.filter((r) => !this.rules.includes(r));
    if (fresh.length === 0) return false;
    this.rules = [...this.rules, ...fresh];
    this.save();
    return true;
  }

  /** Removes a rule; returns true when it was there. */
  remove(rule: string): boolean {
    if (!this.rules.includes(rule)) return false;
    this.rules = this.rules.filter((r) => r !== rule);
    this.save();
    return true;
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, `${JSON.stringify({ allow: this.rules }, null, 2)}\n`);
  }
}

/** A missing or unreadable file means no rules: a broken file must never widen what heroes may do. */
function read(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { allow?: unknown };
    return Array.isArray(parsed.allow)
      ? parsed.allow.filter((r): r is string => typeof r === 'string' && r.length > 0)
      : [];
  } catch {
    return [];
  }
}
