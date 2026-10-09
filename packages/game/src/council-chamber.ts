import type { SittingView, Snapshot } from '@ibitsa/protocol';
import type { ChamberLine, CouncilChamber, CouncilChamberOptions } from './council-chamber.types';
import { button, el } from './dom';
import { councilHandles } from './mentions';
import { recolorFilter, recolorOf } from './recolor';
import { councillorAppearance, councillorTitle } from './sitting-hut';

/** The chamber shows the latest lines; the whole dialogue is in the sitting. */
const SHOWN_LINES = 12;

/** The approved sitting the council answers from mid-campaign (#169), or null when it can't be asked. */
export function consultedSitting(snapshot: Snapshot | null): SittingView | null {
  return councilHandles(snapshot).length > 0 ? (snapshot?.sitting ?? null) : null;
}

/** The chamber's lines: the latest of the dialogue, with each speaker named. */
export function chamberLines(sitting: SittingView): ChamberLine[] {
  return sitting.dialogue.slice(-SHOWN_LINES).map((line) => ({
    id: line.id,
    speaker: line.speaker,
    name: line.speaker === 'you' ? 'You' : councillorTitle(line.speaker),
    text: line.text,
  }));
}

/** What the chamber says about the latest question: thinking, or why it failed. */
export function chamberStatus(sitting: SittingView): string | null {
  const last = sitting.consultations.at(-1);
  if (last?.status === 'asking') return 'The council is thinking…';
  if (last?.status === 'failed') return `The council couldn't answer: ${last.error ?? 'unknown'}`;
  return null;
}

/**
 * The council's chamber mid-campaign (spec §4.8, #169): opened by clicking the hut on the map, it
 * shows the council's latest lines over the hut, and a box to ask the whole council or one councillor.
 * While it's closed, a notice shows each reply as it comes, until it's read. Heroes keep working
 * either way.
 */
export function mountCouncilChamber({
  client,
  portrait,
  onOpen,
  onClose,
}: CouncilChamberOptions): CouncilChamber {
  const panel = el('section', { className: 'council-chamber' });
  panel.setAttribute('aria-label', 'The council');
  panel.hidden = true;
  document.body.appendChild(panel);
  const notice = el('div', { className: 'council-notice' });
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  document.body.appendChild(notice);

  let open = false;
  let shownKey = '';
  let seenLines: number | null = null;
  const draft = { text: '', to: '' };

  const close = () => {
    if (!open) return;
    open = false;
    shownKey = '';
    panel.hidden = true;
    onClose();
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });

  const render = (sitting: SittingView) => {
    const key = JSON.stringify([sitting.dialogue, sitting.consultations]);
    if (key === shownKey) return;
    shownKey = key;
    const typing =
      document.activeElement?.tagName === 'TEXTAREA' && panel.contains(document.activeElement);
    const lines = el('ol', { className: 'chamber-lines' });
    for (const line of chamberLines(sitting)) {
      const item = el('li', { className: line.speaker === 'you' ? 'you' : 'councillor' });
      const src = line.speaker === 'you' ? null : portrait(councillorAppearance(line.speaker));
      if (src) {
        const img = el('img', { className: 'portrait' });
        img.src = src;
        img.alt = '';
        img.style.filter = recolorFilter(recolorOf(`councillor:${line.speaker}`));
        item.append(img);
      }
      item.append(el('strong', { text: `${line.name}: ` }), el('span', { text: line.text }));
      lines.append(item);
    }
    const status = chamberStatus(sitting);
    const to = el('select');
    to.setAttribute('aria-label', 'Ask');
    to.append(new Option('The whole council', ''));
    for (const c of sitting.roster)
      to.append(new Option(councillorTitle(c.councillorId), c.councillorId));
    to.value = draft.to;
    to.onchange = () => {
      draft.to = to.value;
    };
    const box = el('textarea');
    box.setAttribute('aria-label', 'Your question');
    box.placeholder = 'Ask the council… (heroes keep working)';
    box.rows = 2;
    box.value = draft.text;
    box.oninput = () => {
      draft.text = box.value;
    };
    const asking = sitting.consultations.at(-1)?.status === 'asking';
    const send = button({
      label: 'Ask',
      onClick: () => {
        const text = box.value.trim();
        if (!text) return;
        client.send({
          type: 'consultCouncil',
          text,
          ...(to.value ? { councillorId: to.value } : {}),
        });
        draft.text = '';
      },
    });
    send.disabled = asking;
    box.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!send.disabled) send.click();
      }
    };
    panel.replaceChildren(
      el('h2', { text: 'The council' }),
      lines,
      ...(status ? [el('p', { className: 'note chamber-status', text: status })] : []),
      to,
      box,
      (() => {
        const row = el('div', { className: 'chamber-actions' });
        row.append(send, button({ label: 'Back to the map', onClick: close }));
        return row;
      })(),
    );
    lines.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
    // A reply mustn't take the box away from someone typing.
    if (typing) box.focus();
  };

  /**
   * A reply came while the chamber is closed: say who answered, and offer the hut. It stays until the
   * user has read it (#269): **OK** or Escape puts it away, and a newer reply takes its place.
   */
  const tell = (sitting: SittingView) => {
    const line = sitting.dialogue.at(-1);
    if (!line || line.speaker === 'you') return;
    const words = el('p', { className: 'council-notice-words' });
    words.append(
      el('strong', { text: `${councillorTitle(line.speaker)}: ` }),
      el('span', { text: line.text }),
    );
    const actions = el('div', { className: 'council-notice-actions' });
    actions.append(
      button({ label: 'Open the hut', onClick: () => chamber.open() }),
      button({ label: 'OK', onClick: putAway }),
    );
    notice.replaceChildren(words, actions);
    notice.hidden = false;
  };
  const putAway = () => {
    const had = notice.contains(document.activeElement);
    notice.hidden = true;
    if (had) (document.activeElement as HTMLElement | null)?.blur();
  };
  notice.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      putAway();
    }
  });

  client.onSnapshot((snapshot) => {
    const sitting = consultedSitting(snapshot);
    if (!sitting) {
      seenLines = null;
      close();
      return;
    }
    const grew = seenLines !== null && sitting.dialogue.length > seenLines;
    seenLines = sitting.dialogue.length;
    if (open) render(sitting);
    else if (grew) tell(sitting);
  });

  const chamber: CouncilChamber = {
    open: () => {
      const sitting = consultedSitting(client.snapshot);
      if (!sitting) return false;
      notice.hidden = true;
      if (!open) {
        open = true;
        panel.hidden = false;
        onOpen();
      }
      render(sitting);
      panel.querySelector('textarea')?.focus();
      return true;
    },
    close,
    shown: () => open,
  };
  return chamber;
}
