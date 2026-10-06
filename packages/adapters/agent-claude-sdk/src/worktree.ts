import { realpathSync } from 'node:fs';

/**
 * The hero's worktree, for telling whether a path a tool reports is inside it (#33, #56). Tools may give
 * the resolved path (macOS: /var → /private/var), either separator on Windows, and on Windows any case:
 * `C:\\Wt` and `c:/wt` are the same folder there.
 */
export class Worktree {
  readonly dir: string;
  private readonly roots: string[];
  private readonly ignoreCase: boolean;

  constructor({ dir, platform = process.platform }: { dir: string; platform?: NodeJS.Platform }) {
    this.dir = dir;
    this.ignoreCase = platform === 'win32';
    this.roots = [...new Set([dir, resolved(dir)])].map((root) => this.comparable(root));
  }

  /** The path relative to the worktree with `/` separators, '' for the worktree itself; null outside. */
  relative(path: string): string | null {
    const candidate = this.comparable(path);
    for (const root of this.roots) {
      if (candidate === root) return '';
      if (candidate.startsWith(`${root}/`))
        return path.slice(root.length + 1).replaceAll('\\', '/');
    }
    return null;
  }

  contains(path: string): boolean {
    return this.relative(path) !== null;
  }

  /** Same separators everywhere, and one case on Windows; the length never changes. */
  private comparable(path: string): string {
    const slashes = path.replaceAll('\\', '/');
    return this.ignoreCase ? slashes.toLowerCase() : slashes;
  }
}

function resolved(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
  }
}
