import type { ElderView, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { ElderPanelOptions } from './elder-panel.types';
import { gold } from './hero-pane';
import { isSitting } from './sitting-hut';

/** How many files the panel lists; the rest are in `brief.md`. */
const FILES_SHOWN = 8;

/**
 * The elder's recommendation (spec §7.1 screen 1, #101): research progress, then the brief's summary
 * with a quick quest or the council. Plain DOM docked where the hero pane goes, shown while the campaign
 * is planning.
 */
export function mountElderPanel({
  client,
  options,
}: {
  client: GameClient;
  options: ElderPanelOptions;
}): void {
  const panel = el('section', { className: 'elder-panel' });
  panel.setAttribute('aria-label', 'Elder');
  panel.hidden = true;
  document.body.appendChild(panel);
  let shown: string | null = null;

  client.onSnapshot((snapshot: Snapshot) => {
    // While the council sits the hut takes over; the panel comes back when the sitting ends.
    const elder =
      snapshot.campaign?.status === 'planning' && !isSitting(snapshot.sitting)
        ? snapshot.elder
        : null;
    panel.hidden = elder === null;
    if (!elder) {
      shown = null;
      return;
    }
    // Rebuild only when something visible changed, so focus stays put between snapshots.
    const key = JSON.stringify([elder.status, elder.progress, elder.gold, elder.error, elder.id]);
    if (key === shown) return;
    shown = key;
    panel.replaceChildren(...render(elder));
  });

  function render(elder: ElderView): HTMLElement[] {
    const heading = el('h2', { text: 'The elder' });
    const cost = el('p', { className: 'gold', text: `Gold spent: ${gold(elder.gold)}` });
    const abandon = button({
      label: 'Abandon',
      onClick: () => client.send({ type: 'abandonQuest' }),
    });
    if (elder.status === 'researching') {
      const status = el('p', { className: 'progress', text: elder.progress ?? 'Starting…' });
      status.setAttribute('aria-live', 'polite');
      return [heading, el('p', { text: 'Researching your task…' }), status, cost, actions(abandon)];
    }
    if (elder.status === 'failed' || !elder.brief) {
      const error = el('p', { className: 'error', text: elder.error ?? 'The research failed.' });
      error.setAttribute('role', 'alert');
      return [
        heading,
        error,
        cost,
        actions(
          button({
            label: 'Ask again',
            onClick: () => client.send({ type: 'consultElder', task: elder.task }),
          }),
          button({ label: 'Quick quest anyway', onClick: () => options.quickQuest(elder.task) }),
          abandon,
        ),
      ];
    }
    const brief = elder.brief;
    const verdict = el('p', {
      className: brief.quickQuest.recommended ? 'verdict quick' : 'verdict council',
      text: `${brief.quickQuest.recommended ? 'A quick quest will do.' : 'This needs the council.'} ${brief.quickQuest.reason}`,
    });
    const files = el('ul', { className: 'files' });
    for (const f of brief.files.slice(0, FILES_SHOWN)) {
      const li = el('li');
      li.append(el('code', { text: f.lines ? `${f.path}:${f.lines}` : f.path }), ` ${f.note}`);
      files.append(li);
    }
    if (brief.files.length > FILES_SHOWN) {
      files.append(el('li', { text: `…and ${brief.files.length - FILES_SHOWN} more in brief.md` }));
    }
    const findings = el('ul', { className: 'findings' });
    for (const f of brief.findings) findings.append(el('li', { text: f }));
    const councillors = el('ul', { className: 'councillors' });
    for (const c of brief.councillors) {
      const li = el('li');
      li.append(el('strong', { text: c.councillorId }), ` ${c.reason}`);
      councillors.append(li);
    }
    const quick = button({ label: 'Quick quest', onClick: () => options.quickQuest(elder.task) });
    const convene = button({ label: 'Convene council', onClick: () => options.convene() });
    const recommended = brief.quickQuest.recommended ? quick : convene;
    recommended.classList.add('recommended');
    return [
      heading,
      el('p', { className: 'task', text: brief.task }),
      verdict,
      section('Files', files),
      ...(brief.findings.length > 0 ? [section('Findings', findings)] : []),
      ...(brief.councillors.length > 0 ? [section('Recommended councillors', councillors)] : []),
      cost,
      actions(quick, convene, abandon),
    ];
  }
}

function section(title: string, body: HTMLElement): HTMLElement {
  const s = el('div', { className: 'brief-section' });
  s.append(el('h3', { text: title }), body);
  return s;
}

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = el('div', { className: 'actions' });
  row.append(...buttons);
  return row;
}
