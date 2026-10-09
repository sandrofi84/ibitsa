import type { ClosedChoice, GameClosedInput } from './game-closed.types';

/** The choices offered when the game closes mid-campaign, as button labels (#265). */
export const CLOSED_CHOICES: readonly { choice: ClosedChoice; label: string }[] = [
  { choice: 'keep', label: 'Keep Running' },
  { choice: 'pause', label: 'Pause the Heroes' },
  { choice: 'stop', label: 'Stop' },
];

/** The question asked when the game closes while a campaign runs. */
export const CLOSED_QUESTION = 'The game is closed, but your campaign is still running.';
export const CLOSED_DETAIL =
  'Keep Running: heroes and the council carry on, and Ibitsa tells you when something needs you. ' +
  'Pause the Heroes: they stop their turns and wait for orders; the council and reviews carry on. ' +
  'Stop: the heroes stop and Ibitsa shuts down; opening the game picks the campaign up again.';

/**
 * The game tab was closed (#265). With nothing planning or running, Ibitsa shuts down. Mid-campaign
 * the user chooses: keep running in the background (also when they dismiss the question, so nothing
 * is lost), pause the heroes, or stop. Opening the game again reconnects, as after a reload (§12).
 */
export async function gameClosed({
  host,
  ask,
  tell,
}: GameClosedInput): Promise<ClosedChoice | null> {
  if (!host) return null;
  if (!host.campaignLive()) {
    host.dispose();
    return 'stop';
  }
  const choice = (await ask()) ?? 'keep';
  if (choice === 'keep') return choice;
  const paused = await host.pauseHeroes();
  if (choice === 'pause') {
    tell(
      paused > 0
        ? `Paused ${paused === 1 ? '1 hero' : `${paused} heroes`}: they wait for orders in the game.`
        : 'No hero was working. The council and reviews carry on.',
    );
    return choice;
  }
  host.dispose();
  tell('Ibitsa stopped. Open the game to pick the campaign up again.');
  return choice;
}
