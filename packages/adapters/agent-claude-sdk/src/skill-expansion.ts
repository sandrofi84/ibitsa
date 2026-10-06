import type { Expansion, ExpansionInput } from './skill-expansion.types';

/**
 * A skill's prompt as Claude Code expands it, for the preview (#85): `$ARGUMENTS`, positional
 * `$ARGUMENTS[N]` and `$N` (0-based), arguments named in the frontmatter's `arguments`, and
 * `${VARIABLE}`s Ibitsa knows. A prompt without `$ARGUMENTS` gets the arguments appended, as Claude Code
 * does. Shell lines (`` !`cmd` ``) are left as written: Claude Code runs them when the action is sent,
 * never Ibitsa for a preview.
 */
export function expandSkill({ body, fields, args, variables }: ExpansionInput): Expansion {
  const positional = splitArguments(args);
  const names = namedArguments(fields.arguments);
  const notes: string[] = [];
  let usedArguments = false;

  let text = body
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_m, n: string) => {
      usedArguments = true;
      return positional[Number(n)] ?? '';
    })
    .replace(/\$ARGUMENTS\b/g, () => {
      usedArguments = true;
      return args.trim();
    })
    .replace(/\$(\d+)\b/g, (_m, n: string) => {
      usedArguments = true;
      return positional[Number(n)] ?? '';
    })
    .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (m, name: string) => variables[name] ?? m);
  names.forEach((name, i) => {
    const pattern = new RegExp(`\\$${escapeRegExp(name)}\\b`, 'g');
    if (pattern.test(text)) usedArguments = true;
    text = text.replace(pattern, positional[i] ?? '');
  });
  if (!usedArguments && args.trim()) text = `${text.trimEnd()}\n\nARGUMENTS: ${args.trim()}\n`;

  for (const match of text.matchAll(/!`([^`]+)`/g)) {
    notes.push(`Claude Code runs \`${match[1]}\` when this is sent; its output takes its place.`);
  }
  return { text: text.trim(), notes };
}

/** Arguments as Claude Code splits them: by spaces, keeping "quoted words" together. */
function splitArguments(args: string): string[] {
  return [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** `arguments: [issue, branch]` or `arguments: issue branch` → ['issue', 'branch']. */
function namedArguments(field: string | undefined): string[] {
  if (!field) return [];
  return field
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .map((n) => n.replace(/^["']|["']$/g, ''))
    .filter((n) => /^[A-Za-z_][\w-]*$/.test(n));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
