/**
 * How a permission request is shown: exact text from the tool input, never paraphrased (spec §11.2.1).
 * Tools we don't recognize fall back to their raw input so nothing is hidden.
 */
export function describePermission(
  tool: string,
  input: unknown,
): { action: string; target: string } {
  const field = (name: string): string | undefined => {
    const value = (input as Record<string, unknown> | null)?.[name];
    return typeof value === 'string' ? value : undefined;
  };
  const known: Record<string, [string, string]> = {
    Bash: ['Run command', 'command'],
    Edit: ['Edit file', 'file_path'],
    MultiEdit: ['Edit file', 'file_path'],
    Write: ['Write file', 'file_path'],
    NotebookEdit: ['Edit notebook', 'notebook_path'],
    WebFetch: ['Fetch URL', 'url'],
    WebSearch: ['Search the web', 'query'],
  };
  const entry = known[tool];
  const target = entry ? field(entry[1]) : undefined;
  if (entry && target !== undefined) return { action: entry[0], target };
  return { action: tool, target: JSON.stringify(input) ?? String(input) };
}
