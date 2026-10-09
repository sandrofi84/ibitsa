import type { SittingView } from '@ibitsa/protocol';
import type {
  CouncilPaneOptions,
  CouncilWordOptions,
  JournalLine,
  ReportRow,
} from './council-pane.types';
import { button, el } from './dom';
import { gold } from './hero-pane';
import { recolorFilter, recolorOf } from './recolor';
import { councillorAppearance, councillorTitle, isSitting } from './sitting-hut';

/** What the council is doing now (#242), in a line: so a quiet hut is never a mystery. */
export function councilState(sitting: SittingView): string {
  const filed = sitting.roster.filter((c) => c.reported).length;
  const of = `${filed} of ${sitting.roster.length} reports in`;
  if (sitting.status === 'convening') return 'The council is gathering…';
  if (sitting.status === 'awaitingApproval') return 'A plan is waiting for your approval.';
  if (sitting.questions) return 'The council has questions for you.';
  if (sitting.waiting) return 'The council is waiting on you: tell it something, or dismiss it.';
  if (filed < sitting.roster.length) {
    return sitting.mode === 'chambers'
      ? `Councillors are studying in their chambers: ${of}.`
      : `The council is reporting: ${of}.`;
  }
  return 'The council is deliberating…';
}

/** Each councillor's report so far: the latest one's gist, or that it's still being written. */
export function reportRows(sitting: SittingView): ReportRow[] {
  return sitting.roster.map(({ councillorId }) => {
    const report = sitting.reports.filter((r) => r.councillorId === councillorId).at(-1)?.report;
    const title = councillorTitle(councillorId);
    if (!report) return { councillorId, title, filed: false, detail: 'studying…' };
    const counted = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`;
    const detail =
      report.bowOut ??
      `${counted(report.concerns.length, 'concern')}, ${counted(report.questions.length, 'question')}`;
    return { councillorId, title, filed: true, detail };
  });
}

/** Everything said at the sitting, oldest first, each speaker named (#242). */
export function journalOf(sitting: SittingView): JournalLine[] {
  return sitting.dialogue.map((line) => ({
    id: line.id,
    speaker: line.speaker,
    name: line.speaker === 'you' ? 'You' : councillorTitle(line.speaker),
    text: line.text,
  }));
}

/**
 * The council's latest word for the user (#242): its last line, unless the user spoke last or the
 * line is about a question still open, which the dialogue box shows.
 */
export function latestWord(sitting: SittingView): JournalLine | null {
  const line = journalOf(sitting).at(-1);
  if (!line || line.speaker === 'you') return null;
  const about = sitting.dialogue.at(-1)?.questionId;
  const open = sitting.questions?.items.some((q) => q.id === about) ?? false;
  return open ? null : line;
}

/**
 * The council's pane in the hut (#242), docked top right like the hero pane: what the council is
 * doing, each councillor's report, the journal of everything said, the gold spent, and **Dismiss the
 * council** at any point of the sitting. Collapsed, its tab still says what the council is doing.
 */
export function mountCouncilPane({ client, portrait }: CouncilPaneOptions): void {
  const pane = el('section', { className: 'council-pane' });
  pane.setAttribute('aria-label', 'The council');
  pane.hidden = true;
  const tab = el('button', { className: 'council-pane-tab' });
  tab.type = 'button';
  tab.setAttribute('aria-controls', 'council-pane-body');
  const body = el('div', { className: 'council-pane-body' });
  body.id = 'council-pane-body';
  pane.append(tab, body);
  document.body.appendChild(pane);

  let open = false;
  let confirming = false;
  let shown = '';
  tab.onclick = () => {
    open = !open;
    render(true);
  };

  const render = (force = false) => {
    const sitting = client.snapshot?.sitting;
    if (!isSitting(sitting)) {
      pane.hidden = true;
      open = false;
      confirming = false;
      shown = '';
      return;
    }
    pane.hidden = false;
    const state = councilState(sitting);
    // Collapsed, the tab says what the council is doing; open, the pane does.
    tab.textContent = open ? 'Council' : `Council · ${state}`;
    tab.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    const key = JSON.stringify([open, confirming, sitting.roster, sitting.dialogue, sitting.gold]);
    if (!force && key === shown) return;
    shown = key;
    if (!open) return;
    const reports = el('ul', { className: 'council-reports' });
    reports.setAttribute('aria-label', 'Reports');
    for (const row of reportRows(sitting)) {
      const li = el('li', { className: row.filed ? 'filed' : 'pending' });
      li.append(el('strong', { text: `${row.title}: ` }), el('span', { text: row.detail }));
      reports.append(li);
    }
    const journal = el('ol', { className: 'council-journal' });
    journal.setAttribute('aria-label', 'Journal');
    journal.tabIndex = 0;
    const lines = journalOf(sitting);
    if (lines.length === 0)
      journal.append(el('li', { className: 'note', text: 'Nothing said yet.' }));
    for (const line of lines) journal.append(lineItem({ line, portrait }));
    body.replaceChildren(
      el('p', { className: 'council-state', text: state }),
      el('h3', { text: 'Reports' }),
      reports,
      el('h3', { text: 'Journal' }),
      journal,
      el('p', { className: 'note', text: `Gold spent: ${gold(sitting.gold)}` }),
      dismissRow(),
    );
    journal.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
  };

  /** Dismiss asks once more: the sitting ends, and with it any plan. */
  const dismissRow = () => {
    const row = el('div', { className: 'actions' });
    if (!confirming) {
      row.append(
        button({
          label: 'Dismiss the council',
          onClick: () => {
            confirming = true;
            render(true);
          },
        }),
      );
      return row;
    }
    row.append(
      el('span', {
        text: 'End the sitting? Its reports are kept in the log; no plan comes of it.',
      }),
      button({ label: 'Dismiss', onClick: () => client.send({ type: 'dismissCouncil' }) }),
      button({
        label: 'Keep sitting',
        onClick: () => {
          confirming = false;
          render(true);
        },
      }),
    );
    return row;
  };

  client.onSnapshot(() => render());
}

/**
 * The council's latest word over the command bar (#242): a line that isn't about an open question
 * (say, the elder ending its turn) would otherwise show nowhere in the hut.
 */
export function mountCouncilWord({ client, portrait, into }: CouncilWordOptions): void {
  const word = el('div', { className: 'council-word' });
  word.setAttribute('role', 'status');
  word.hidden = true;
  into.prepend(word);
  let shown = '';
  client.onSnapshot((snapshot) => {
    const sitting = snapshot.sitting;
    const line = isSitting(sitting) ? latestWord(sitting) : null;
    word.hidden = !line;
    if (!line || line.id === shown) {
      if (!line) shown = '';
      return;
    }
    shown = line.id;
    word.replaceChildren(lineItem({ line, portrait, tag: 'div' }));
  });
}

/** One spoken line: the councillor's portrait, name and words, or the user's. */
function lineItem({
  line,
  portrait,
  tag = 'li',
}: {
  line: JournalLine;
  portrait: CouncilPaneOptions['portrait'];
  tag?: 'li' | 'div';
}): HTMLElement {
  const item = el(tag, { className: line.speaker === 'you' ? 'you' : 'councillor' });
  const src = line.speaker === 'you' ? null : portrait(councillorAppearance(line.speaker));
  if (src) {
    const img = el('img', { className: 'portrait' });
    img.src = src;
    img.alt = '';
    img.style.filter = recolorFilter(recolorOf(`councillor:${line.speaker}`));
    item.append(img);
  }
  item.append(el('strong', { text: `${line.name}: ` }), el('span', { text: line.text }));
  return item;
}
