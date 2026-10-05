import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Activity } from './activity.types';

/** Bash commands that count as running tests (spec §5.4), on top of the worktree's own `test*` scripts. */
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

const DETAIL_MAX = 120;

/** Which Bash commands count as tests, for one worktree. */
export class TestDetector {
  private readonly scripts: string[];

  constructor(cwd: string) {
    this.scripts = testScripts(cwd);
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

/** Tool → activity kind and a short display detail (spec §5.4). Never the raw input. */
export function classify({
  tool,
  input,
  cwd,
  tests,
}: {
  tool: string;
  input: unknown;
  cwd: string;
  tests: TestDetector;
}): Activity {
  const field = (name: string) => {
    const value = (input as Record<string, unknown> | null)?.[name];
    return typeof value === 'string' ? value : undefined;
  };
  const path = (name: string) => {
    const value = field(name);
    if (value === undefined) return undefined;
    // Tools may report the resolved path (on macOS /var is a symlink to /private/var).
    const root = [cwd, realpath(cwd)].find((dir) => value.startsWith(`${dir}/`));
    return shorten(root ? relative(root, value) : value);
  };
  const withDetail = (kind: Activity['kind'], detail: string | undefined): Activity =>
    detail === undefined ? { kind } : { kind, detail };
  switch (tool) {
    case 'Read':
      return withDetail('read', path('file_path'));
    case 'NotebookRead':
      return withDetail('read', path('notebook_path'));
    case 'Grep':
    case 'Glob':
      return withDetail('search', field('pattern') && shorten(field('pattern') as string));
    case 'WebSearch':
      return withDetail('search', field('query') && shorten(field('query') as string));
    case 'WebFetch':
      return withDetail('search', field('url') && shorten(field('url') as string));
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      return withDetail('edit', path('file_path'));
    case 'NotebookEdit':
      return withDetail('edit', path('notebook_path'));
    case 'Bash': {
      const command = field('command') ?? '';
      return withDetail(tests.isTest(command) ? 'test' : 'run', shorten(command));
    }
    default:
      return { kind: 'other', detail: tool };
  }
}

function shorten(text: string): string {
  const line = text.split('\n')[0] ?? '';
  return line.length > DETAIL_MAX ? `${line.slice(0, DETAIL_MAX - 1)}…` : line;
}

function realpath(dir: string): string {
  try {
    return realpathSync(dir);
  } catch {
    return dir;
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
