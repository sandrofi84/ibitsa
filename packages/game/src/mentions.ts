import { type HeroView, heroHandle, type Snapshot } from '@ibitsa/protocol';
import type { ParsedMessage } from './mentions.types';

/** Everyone working: `@all` (one hero in M2; every party's hero from M4). */
export const ALL = 'all';
/** The whole council, mid-campaign (§4.8, #169). */
export const COUNCIL = 'council';

/**
 * Who on the council can be asked now (#169): `council` and each councillor who sat, once the plan
 * is approved and the campaign under way; nobody otherwise.
 */
export function councilHandles(snapshot: Snapshot | null): string[] {
  const sitting = snapshot?.sitting;
  if (snapshot?.campaign?.status !== 'active' || sitting?.status !== 'approved') return [];
  return [COUNCIL, ...sitting.roster.map((c) => c.councillorId)];
}

/**
 * A command bar message for the council (#169): `@council` asks the whole council, `@<councillor id>`
 * one councillor. Null when the message names neither (it goes to heroes).
 */
export function councilMessage({
  text,
  snapshot,
}: {
  text: string;
  snapshot: Snapshot | null;
}): { councillorId: string | null; text: string } | null {
  const parsed = parseMessage({ text, recipients: councilHandles(snapshot) });
  if (!parsed.recipient || !parsed.text) return null;
  return {
    councillorId: parsed.recipient === COUNCIL ? null : parsed.recipient,
    text: parsed.text,
  };
}

/** The sitting statuses in which the council plans, and hears the user from the command bar (#242). */
const PLANNING = ['convening', 'deliberating', 'awaitingApproval'];

/** Who can be named while the council sits (#242): `council` and each councillor on the roster. */
export function sittingHandles(snapshot: Snapshot | null): string[] {
  const sitting = snapshot?.sitting;
  if (!sitting || !PLANNING.includes(sitting.status)) return [];
  return [COUNCIL, ...sitting.roster.map((c) => c.councillorId)];
}

/**
 * A command bar message while the council sits (#242): everything goes to the council, to one
 * councillor when an @ names it. Null when the council isn't sitting or there's nothing to say.
 */
export function sittingMessage({
  text,
  snapshot,
}: {
  text: string;
  snapshot: Snapshot | null;
}): { councillorId: string | null; text: string } | null {
  const handles = sittingHandles(snapshot);
  if (handles.length === 0) return null;
  const parsed = parseMessage({ text, recipients: handles });
  if (!parsed.text) return null;
  const named = parsed.recipient !== null && parsed.recipient !== COUNCIL;
  return { councillorId: named ? parsed.recipient : null, text: parsed.text };
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

/**
 * Who a command bar message goes to (#125): the hero its @ names, every hero with a session for `@all`
 * (a blocked hero has none yet), else the selected hero. The text comes back without the recipient.
 */
export function messageTargets({
  text,
  heroes,
  selected,
}: {
  text: string;
  heroes: readonly HeroView[];
  selected: string | null;
}): { targets: HeroView[]; text: string } {
  const parsed = parseMessage({
    text,
    recipients: [...heroes.map((h) => heroHandle(h.name)), ALL],
  });
  const targets =
    parsed.recipient === ALL
      ? heroes.filter((h) => h.state.kind !== 'blocked')
      : heroes.filter((h) =>
          parsed.recipient ? heroHandle(h.name) === parsed.recipient : h.id === selected,
        );
  return { targets, text: parsed.text };
}

/** The hero whose worktree a message is about: the one its @ names, else the selected one (#125). */
export function addressedHero({
  text,
  heroes,
  selected,
}: {
  text: string;
  heroes: readonly HeroView[];
  selected: string | null;
}): HeroView | null {
  const named = parseMessage({ text, recipients: heroes.map((h) => heroHandle(h.name)) }).recipient;
  return (
    heroes.find((h) => named !== null && heroHandle(h.name) === named) ??
    heroes.find((h) => h.id === selected) ??
    heroes[0] ??
    null
  );
}
