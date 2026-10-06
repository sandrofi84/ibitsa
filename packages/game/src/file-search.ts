/**
 * Fuzzy search over a worktree's files for @ references (#83). A file whose name starts with the query
 * ranks first, then one whose name contains it, then one whose path does, then one whose path holds the
 * query's letters in order (fewer gaps first); shorter paths win ties.
 */
export function rankPaths({
  paths,
  query,
  limit = 8,
}: {
  paths: readonly string[];
  query: string;
  limit?: number;
}): string[] {
  const q = query.toLowerCase();
  return paths
    .map((path) => ({ path, score: score({ path: path.toLowerCase(), q }) }))
    .filter((r): r is { path: string; score: number } => r.score !== null)
    .sort(
      (a, b) => a.score - b.score || a.path.length - b.path.length || a.path.localeCompare(b.path),
    )
    .slice(0, limit)
    .map((r) => r.path);
}

function score({ path, q }: { path: string; q: string }): number | null {
  if (!q) return 0;
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (path.includes(q)) return 2;
  let at = -1;
  let gaps = 0;
  for (const ch of q) {
    const next = path.indexOf(ch, at + 1);
    if (next < 0) return null;
    if (at >= 0 && next > at + 1) gaps += 1;
    at = next;
  }
  return 3 + gaps;
}
