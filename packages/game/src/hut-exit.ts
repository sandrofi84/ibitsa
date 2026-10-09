import { button } from './dom';

/**
 * The hut's door back to the map (#245), in the hut's top-left corner. Shown only in the hut (CSS);
 * leaving neither pauses nor ends the sitting.
 */
export function mountHutExit(onLeave: () => void): HTMLButtonElement {
  const exit = button({ label: '← Map', onClick: onLeave });
  exit.className = 'hut-exit';
  exit.setAttribute('aria-label', 'Back to the map');
  exit.title = 'Back to the map. The council keeps working; click the hut to come back.';
  document.body.appendChild(exit);
  return exit;
}
