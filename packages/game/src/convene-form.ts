import type { Effort, SittingMode, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import type { ConveneForm } from './convene-form.types';
import { button, el } from './dom';
import type { ViewState } from './view-state';

const ROSTER_KEY = 'conveneRoster';
const EFFORT_KEY = 'conveneEffort';
const MODE_KEY = 'conveneMode';

/** A round table's model and cap by effort (spec §4.2), as the runtime runs it. */
const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'light', label: 'Light: Haiku, up to $0.50' },
  { id: 'standard', label: 'Standard: Sonnet, up to $2' },
  { id: 'deep', label: 'Deep: Opus, up to $6' },
];
const ROUND_TABLE_CAP: Record<Effort, number> = { light: 0.5, standard: 2, deep: 6 };

/** A chamber's model and share of the cap by its councillor's effort (spec §4.2), as the runtime runs it. */
const CHAMBER_EFFORTS: { id: Effort; label: string }[] = [
  { id: 'light', label: 'Light: Haiku, $0.10' },
  { id: 'standard', label: 'Standard: Sonnet, $0.40' },
  { id: 'deep', label: 'Deep: Sonnet, $1.20, Opus on a serious concern' },
];
const CHAMBER_CAP: Record<Effort, number> = { light: 0.1, standard: 0.4, deep: 1.2 };
/** What the chairing elder keeps for summing up in separate chambers. */
const ELDER_RESERVE = 0.3;

/**
 * The most a sitting may cost, in dollars (spec §4.2): a round table's cap by its effort, or every
 * chamber's share plus the elder's reserve.
 */
export function estimatedCap({
  mode,
  effort,
  chambers,
}: {
  mode: SittingMode;
  effort: Effort;
  chambers: readonly Effort[];
}): number {
  if (mode === 'roundTable') return ROUND_TABLE_CAP[effort];
  return chambers.reduce((sum, e) => sum + CHAMBER_CAP[e], ELDER_RESERVE);
}

/**
 * Convening the council (spec §4.2, #103, #105): how it sits, who sits, and the effort; in separate
 * chambers, an effort for each councillor. The elder's recommendations come pre-set with its reasons;
 * without a brief, the last selection in this project does. Plain DOM in a native <dialog>.
 */
export function mountConveneForm({
  client,
  view,
}: {
  client: GameClient;
  view: ViewState;
}): ConveneForm {
  const dialog = el('dialog', { className: 'convene' });
  dialog.setAttribute('aria-label', 'Convene the council');
  document.body.appendChild(dialog);
  let snapshot: Snapshot | null = null;
  client.onSnapshot((s) => {
    snapshot = s;
    if (dialog.open && s.campaign?.status !== 'planning') dialog.close();
  });

  function open(): void {
    const elder = snapshot?.elder;
    if (!snapshot || snapshot.campaign?.status !== 'planning' || !elder || dialog.open) return;
    const brief = elder.brief;
    const form = el('form');
    const error = el('p', { className: 'error' });
    error.setAttribute('role', 'alert');

    // How the council sits: asked, or the setting.
    const setting = snapshot.councilMode ?? 'ask';
    let mode: SittingMode =
      setting === 'ask' ? (view.get(MODE_KEY, 'roundTable') as SittingMode) : setting;
    const sitting = el('fieldset');
    sitting.append(el('legend', { text: 'How the council sits' }));
    if (setting === 'ask') {
      const radios = [
        choice({
          name: 'mode',
          value: 'roundTable',
          label:
            'Round table: one session voices every councillor. Cheaper and quicker; the roles may blur.',
          checked: mode === 'roundTable',
        }),
        choice({
          name: 'mode',
          value: 'chambers',
          label:
            'Separate chambers: each councillor studies alone after my briefing. Sharper roles; costs more.',
          checked: mode === 'chambers',
        }),
      ];
      for (const radio of radios) {
        radio.querySelector('input')?.addEventListener('change', (e) => {
          mode = (e.target as HTMLInputElement).value as SittingMode;
          update();
        });
      }
      sitting.append(...radios);
    } else {
      sitting.append(
        el('p', {
          text:
            setting === 'roundTable'
              ? 'At a round table (your setting).'
              : 'In separate chambers (your setting).',
        }),
      );
    }

    // Who sits, and in chambers each one's effort.
    const remembered = view.get(ROSTER_KEY, '').split(',').filter(Boolean);
    const recommended = new Map((brief?.councillors ?? []).map((c) => [c.councillorId, c.reason]));
    const suggested = new Map((brief?.councillorEfforts ?? []).map((e) => [e.councillorId, e]));
    const roster = el('fieldset', { className: 'roster' });
    roster.append(el('legend', { text: 'Councillors' }));
    const seats: { box: HTMLInputElement; effort: HTMLSelectElement; row: HTMLElement }[] = [];
    for (const c of snapshot.councillors ?? []) {
      const reason = recommended.get(c.id);
      const row = el('div', { className: 'seat' });
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.value = c.id;
      box.checked =
        brief && recommended.size > 0 ? reason !== undefined : remembered.includes(c.id);
      label.append(
        box,
        el('strong', { text: c.title }),
        ` ${reason ? `The elder: ${reason}` : c.description}`,
      );
      const effort = el('select', { className: 'seat-effort' });
      effort.setAttribute('aria-label', `${c.title}'s effort`);
      for (const e of CHAMBER_EFFORTS) effort.add(new Option(e.label, e.id));
      const suggestion = suggested.get(c.id);
      effort.value = suggestion?.level ?? brief?.effort.level ?? 'standard';
      if (suggestion) effort.title = `The elder: ${suggestion.reason}`;
      const effortRow = el('div', { className: 'seat-effort-row' });
      effortRow.append(
        effort,
        ...(suggestion ? [el('span', { className: 'note', text: ` ${suggestion.reason}` })] : []),
      );
      row.append(label, effortRow);
      seats.push({ box, effort, row: effortRow });
      roster.append(row);
    }
    if (seats.length === 0) roster.append(el('p', { text: 'No councillors found.' }));

    // The sitting's effort: the round table's, or the chairing elder's in chambers.
    const effort = el('select');
    for (const e of EFFORTS) effort.add(new Option(e.label, e.id));
    effort.value = brief?.effort.level ?? view.get(EFFORT_KEY, 'standard');
    const effortLabel = el('span', { text: 'Effort' });
    const effortField = el('label');
    effortField.append(effortLabel, effort);
    const effortNote = el('p', {
      className: 'note',
      text: brief ? `The elder: ${brief.effort.reason}` : '',
    });
    const cap = el('p', { className: 'cap' });
    cap.setAttribute('aria-live', 'polite');

    const convene = el('button', { text: 'Convene' });
    convene.type = 'submit';
    const chosen = () => seats.filter((s) => s.box.checked);
    function update(): void {
      const chambers = mode === 'chambers';
      for (const s of seats) s.row.hidden = !chambers || !s.box.checked;
      effortLabel.textContent = chambers ? 'The elder chairs at' : 'Effort';
      effort.setAttribute('aria-label', effortLabel.textContent);
      const dollars = estimatedCap({
        mode,
        effort: effort.value as Effort,
        chambers: chosen().map((s) => s.effort.value as Effort),
      });
      cap.textContent = `Costs up to $${dollars.toFixed(2)}.`;
      convene.disabled = chosen().length === 0;
    }
    for (const s of seats) {
      s.box.onchange = update;
      s.effort.onchange = update;
    }
    effort.onchange = update;
    update();
    form.append(
      el('h2', { text: 'Convene the council' }),
      el('p', { className: 'task', text: elder.task.split('\n')[0] ?? '' }),
      sitting,
      roster,
      effortField,
      effortNote,
      cap,
      error,
      el('div', { className: 'actions' }),
    );
    form.lastElementChild?.append(
      convene,
      button({ label: 'Cancel', onClick: () => dialog.close() }),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      const picked = chosen();
      if (picked.length === 0) {
        error.textContent = 'Choose at least one councillor.';
        return;
      }
      const ids = picked.map((s) => s.box.value);
      view.set(ROSTER_KEY, ids.join(','));
      view.set(EFFORT_KEY, effort.value);
      if (setting === 'ask') view.set(MODE_KEY, mode);
      client.send({
        type: 'conveneCouncil',
        task: elder.task,
        mode,
        roster: ids,
        effort: effort.value as Effort,
        ...(mode === 'chambers'
          ? {
              councillorEfforts: Object.fromEntries(
                picked.map((s) => [s.box.value, s.effort.value as Effort]),
              ),
            }
          : {}),
      });
      dialog.close();
    };
    dialog.replaceChildren(form);
    dialog.showModal();
    (seats.find((s) => s.box.checked)?.box ?? seats[0]?.box ?? effort).focus();
  }

  return { open };
}

function choice({
  name,
  value,
  label,
  checked = false,
}: {
  name: string;
  value: string;
  label: string;
  checked?: boolean;
}): HTMLLabelElement {
  const wrapper = el('label');
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  wrapper.append(input, ` ${label}`);
  return wrapper;
}
