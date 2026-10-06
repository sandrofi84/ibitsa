import type { ParsedMessage } from './mentions.types';

/** Everyone working: `@all` (one hero in M2; every party's hero from M4). */
export const ALL = 'all';

/** A hero's @handle: its name in lower case with dashes, e.g. "Ranger Ilse" → `ranger-ilse`. */
export function heroHandle(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Reads a command bar message (spec §6.1, #83): the first @mention that names a recipient is the
 * recipient, and is taken out of the text; every other @mention stays as written, so a file reference
 * like `@src/app.ts` reaches the hero as a path to read.
 */
export function parseMessage({
  text,
  recipients,
}: {
  text: string;
  recipients: readonly string[];
}): ParsedMessage {
  for (const match of text.matchAll(/(^|\s)@(\S+)/g)) {
    // Both groups always match (the first possibly empty), and matchAll always sets the index.
    const [, lead, handle] = match as unknown as [string, string, string];
    if (!recipients.includes(handle)) continue;
    const start = (match.index as number) + lead.length;
    const end = start + handle.length + 1;
    const rest = `${text.slice(0, start)}${text.slice(end)}`.replace(/\s{2,}/g, ' ').trim();
    return { recipient: handle, text: rest };
  }
  return { recipient: null, text: text.trim() };
}
