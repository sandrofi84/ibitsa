import type { TestDetector } from '@ibitsa/runtime';
import type { Activity } from './activity.types';
import type { Worktree } from './worktree';

const DETAIL_MAX = 120;

/** Tool → activity kind and a short display detail (spec §5.4). Never the raw input. */
export function classify({
  tool,
  input,
  worktree,
  tests,
}: {
  tool: string;
  input: unknown;
  worktree: Worktree;
  tests: TestDetector;
}): Activity {
  const field = (name: string) => {
    const value = (input as Record<string, unknown> | null)?.[name];
    return typeof value === 'string' ? value : undefined;
  };
  const path = (name: string) => {
    const value = field(name);
    if (value === undefined) return undefined;
    // Inside the worktree the detail is relative, with `/` (see Worktree for the spellings it accepts).
    const inside = worktree.relative(value);
    return shorten(inside === null ? value : inside || '.');
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
