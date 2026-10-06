import { createHash } from 'node:crypto';
import type { CouncillorInfo } from '@ibitsa/protocol';
import type { CouncilVersionInput } from './council.types';

/**
 * A short id for the council as it sat (§4.10, #98): its mode, which councillors with which skill files,
 * and Ibitsa's prompt version. Tallies group by it, so editing a councillor or a prompt starts a new group.
 * The roster's order doesn't matter.
 */
export function councilVersion({ mode, councillors, promptVersion }: CouncilVersionInput): string {
  const seats = councillors.map((c) => `${c.id}@${c.hash}`).sort();
  return createHash('sha256')
    .update(JSON.stringify({ mode, seats, promptVersion }))
    .digest('hex')
    .slice(0, 12);
}

/** The councillors the user hasn't turned off (`ibitsa.council.disabled`, §4.7). */
export function seatable(
  councillors: readonly CouncillorInfo[],
  disabled: readonly string[],
): CouncillorInfo[] {
  return councillors.filter((c) => !disabled.includes(c.id));
}
