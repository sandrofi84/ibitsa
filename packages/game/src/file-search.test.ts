import { describe, expect, it } from 'vitest';
import { rankPaths } from './file-search';

const paths = [
  'README.md',
  'src/auth/redirect.ts',
  'src/auth/login.ts',
  'src/app.ts',
  'docs/redirects.md',
  'test/auth/redirect.test.ts',
];

describe('rankPaths (#83)', () => {
  it('puts names starting with the query first, then names and paths containing it', () => {
    expect(rankPaths({ paths, query: 'redir' })).toEqual([
      'docs/redirects.md',
      'src/auth/redirect.ts',
      'test/auth/redirect.test.ts',
    ]);
    expect(rankPaths({ paths, query: 'auth' })).toEqual([
      'src/auth/login.ts',
      'src/auth/redirect.ts',
      'test/auth/redirect.test.ts',
    ]);
  });

  it("matches the query's letters in order, with fewer gaps first", () => {
    expect(rankPaths({ paths, query: 'sal' })).toEqual(['src/auth/login.ts']);
    expect(rankPaths({ paths, query: 'zzz' })).toEqual([]);
  });

  it('breaks remaining ties alphabetically', () => {
    expect(rankPaths({ paths: ['b/x.ts', 'a/x.ts'], query: 'x' })).toEqual(['a/x.ts', 'b/x.ts']);
  });

  it('is case-insensitive, lists the shortest paths for an empty query, and keeps to the limit', () => {
    expect(rankPaths({ paths, query: 'APP' })).toEqual(['src/app.ts']);
    expect(rankPaths({ paths, query: '', limit: 2 })).toEqual(['README.md', 'src/app.ts']);
  });
});
