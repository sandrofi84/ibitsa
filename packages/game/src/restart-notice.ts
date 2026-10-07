import type { Cue, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';

/** How long the notice stays, unless clicked away. */
const SHOW_MS = 10_000;

/**
 * After VS Code reloads (§12, #166): a one-time notice of what resumed on its own. Nothing to decide,
 * so never a "Needs you" item.
 */
export function mountRestartNotice({ client }: { client: GameClient }): void {
  const notice = document.createElement('div');
  notice.className = 'toast restart-notice';
  notice.setAttribute('role', 'status');
  notice.addEventListener('click', () => notice.classList.remove('visible'));
  document.body.appendChild(notice);
  let timer: ReturnType<typeof setTimeout> | undefined;
  client.onCue((cue) => {
    if (cue.type !== 'resumed') return;
    notice.textContent = resumedText({ cue, snapshot: client.snapshot });
    notice.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => notice.classList.remove('visible'), SHOW_MS);
  });
}

/** "VS Code reloaded: resumed Ranger Ilse and Rogue Vex, restarted 1 review." */
export function resumedText({
  cue,
  snapshot,
}: {
  cue: Extract<Cue, { type: 'resumed' }>;
  snapshot: Snapshot | null;
}): string {
  const names = cue.heroIds.map((id) => snapshot?.heroes.find((h) => h.id === id)?.name ?? id);
  const parts = [
    ...(names.length > 0 ? [`resumed ${list(names)}`] : []),
    ...(cue.council ? ['resumed the council'] : []),
    ...(cue.elder ? ["restarted the elder's research"] : []),
    ...(cue.checks > 0 ? [`ran ${plural({ n: cue.checks, word: 'check' })} again`] : []),
    ...(cue.reviews > 0 ? [`restarted ${plural({ n: cue.reviews, word: 'review' })}`] : []),
  ];
  return `VS Code reloaded: ${parts.join(', ')}.`;
}

function list(names: string[]): string {
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function plural({ n, word }: { n: number; word: string }): string {
  return n === 1 ? `1 ${word}` : `${n} ${word}s`;
}
