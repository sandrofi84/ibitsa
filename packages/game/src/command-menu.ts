import type { MenuToken } from './command-menu.types';

/**
 * The token being typed at the caret, if it starts with one of `triggers` (#83). A trigger only counts
 * at the start of the input or after whitespace, so `ada@example.com` never opens the @ menu.
 */
export function activeToken({
  text,
  caret,
  triggers,
}: {
  text: string;
  caret: number;
  triggers: readonly string[];
}): MenuToken | null {
  const before = text.slice(0, caret);
  const start =
    Math.max(before.lastIndexOf(' '), before.lastIndexOf('\n'), before.lastIndexOf('\t')) + 1;
  const token = before.slice(start);
  const trigger = token[0];
  if (!trigger || !triggers.includes(trigger)) return null;
  return { trigger, start, token, query: token.slice(1) };
}

/** The input after choosing `insert` for `token`: it replaces the token, and a space follows. */
export function applyChoice({
  text,
  caret,
  token,
  insert,
}: {
  text: string;
  caret: number;
  token: MenuToken;
  insert: string;
}): { text: string; caret: number } {
  const after = text.slice(caret);
  const spaced = after.startsWith(' ') ? after : ` ${after}`;
  const next = `${text.slice(0, token.start)}${insert}${spaced}`;
  return { text: next, caret: token.start + insert.length + 1 };
}
