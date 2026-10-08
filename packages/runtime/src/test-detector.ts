import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shell commands that count as running tests (spec §5.4), on top of the worktree's own `test*` scripts.
 * Shared by the agent adapters, which each turn their own tool calls into activities.
 */
const DEFAULT_TEST_PATTERNS = [
  /\b(pnpm|npm|yarn|bun)\s+(run\s+)?test\b/,
  /\bvitest\b/,
  /\bjest\b/,
  /\bpytest\b/,
  /\bgo\s+test\b/,
  /\bcargo\s+test\b/,
  /\bplaywright\s+test\b/,
  /\bmocha\b/,
];

/** Which shell commands count as tests, for one worktree. */
export class TestDetector {
  private readonly scripts: string[];

  constructor(cwd: string) {
    this.scripts = testScripts(cwd);
  }

  /** The worktree's own `test*` script names. */
  get scriptNames(): readonly string[] {
    return this.scripts;
  }

  isTest(command: string): boolean {
    return (
      DEFAULT_TEST_PATTERNS.some((p) => p.test(command)) ||
      this.scripts.some((name) =>
        new RegExp(`\\b(run\\s+)?${escapeRegExp(name)}(\\s|$)`).test(command),
      )
    );
  }
}

function testScripts(cwd: string): string[] {
  const file = join(cwd, 'package.json');
  if (!existsSync(file)) return [];
  try {
    const scripts = (JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> })
      .scripts;
    return Object.keys(scripts ?? {}).filter((name) => name.startsWith('test'));
  } catch {
    return [];
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
