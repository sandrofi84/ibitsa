import type { Effort, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import type { ConveneForm } from './convene-form.types';
import { button, el } from './dom';
import type { ViewState } from './view-state';

const ROSTER_KEY = 'conveneRoster';
const EFFORT_KEY = 'conveneEffort';

/** A round table's model and cap by effort (spec §4.2), as the runtime runs it. */
const EFFORTS: { id: Effort; label: string }[] = [
  { id: 'light', label: 'Light: Haiku, up to $0.50' },
  { id: 'standard', label: 'Standard: Sonnet, up to $2' },
  { id: 'deep', label: 'Deep: Opus, up to $6' },
];

/**
 * Convening the council (spec §4.2, #103): how it sits, who sits, and the effort. The elder's
 * recommendations come pre-checked with its reasons; without a brief, the last selection in this
 * project does. Separate chambers shows but waits for #105. Plain DOM in a native <dialog>.
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

    // How the council sits.
    const mode = snapshot.councilMode ?? 'ask';
    const sitting = el('fieldset');
    sitting.append(el('legend', { text: 'How the council sits' }));
    if (mode === 'ask') {
      sitting.append(
        choice({
          name: 'mode',
          value: 'roundTable',
          label:
            'Round table: one session voices every councillor. Cheaper and quicker; the roles may blur.',
          checked: true,
        }),
        choice({
          name: 'mode',
          value: 'chambers',
          label:
            'Separate chambers: each councillor studies alone. Sharper roles; costs more. (Not available yet.)',
          disabled: true,
        }),
      );
    } else {
      sitting.append(
        el('p', {
          text:
            mode === 'roundTable'
              ? 'At a round table (your setting).'
              : "At a round table: separate chambers, your setting, isn't available yet.",
        }),
      );
    }

    // Who sits.
    const remembered = view.get(ROSTER_KEY, '').split(',').filter(Boolean);
    const recommended = new Map((brief?.councillors ?? []).map((c) => [c.councillorId, c.reason]));
    const roster = el('fieldset', { className: 'roster' });
    roster.append(el('legend', { text: 'Councillors' }));
    const boxes: HTMLInputElement[] = [];
    for (const c of snapshot.councillors ?? []) {
      const reason = recommended.get(c.id);
      const checked =
        brief && recommended.size > 0 ? reason !== undefined : remembered.includes(c.id);
      const label = el('label');
      const box = el('input');
      box.type = 'checkbox';
      box.value = c.id;
      box.checked = checked;
      boxes.push(box);
      label.append(
        box,
        el('strong', { text: c.title }),
        ` ${reason ? `The elder: ${reason}` : c.description}`,
      );
      roster.append(label);
    }
    if (boxes.length === 0) roster.append(el('p', { text: 'No councillors found.' }));

    // The effort.
    const effort = el('select');
    for (const e of EFFORTS) effort.add(new Option(e.label, e.id));
    effort.value = brief?.effort.level ?? view.get(EFFORT_KEY, 'standard');
    const effortField = el('label');
    effortField.append(el('span', { text: 'Effort' }), effort);
    const effortNote = el('p', {
      className: 'note',
      text: brief ? `The elder: ${brief.effort.reason}` : '',
    });

    const convene = el('button', { text: 'Convene' });
    convene.type = 'submit';
    const update = () => {
      convene.disabled = !boxes.some((b) => b.checked);
    };
    for (const b of boxes) b.onchange = update;
    update();
    form.append(
      el('h2', { text: 'Convene the council' }),
      el('p', { className: 'task', text: elder.task.split('\n')[0] ?? '' }),
      sitting,
      roster,
      effortField,
      effortNote,
      error,
      el('div', { className: 'actions' }),
    );
    form.lastElementChild?.append(
      convene,
      button({ label: 'Cancel', onClick: () => dialog.close() }),
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      const chosen = boxes.filter((b) => b.checked).map((b) => b.value);
      if (chosen.length === 0) {
        error.textContent = 'Choose at least one councillor.';
        return;
      }
      view.set(ROSTER_KEY, chosen.join(','));
      view.set(EFFORT_KEY, effort.value);
      client.send({
        type: 'conveneCouncil',
        task: elder.task,
        mode: 'roundTable',
        roster: chosen,
        effort: effort.value as Effort,
      });
      dialog.close();
    };
    dialog.replaceChildren(form);
    dialog.showModal();
    (boxes.find((b) => b.checked) ?? boxes[0] ?? effort).focus();
  }

  return { open };
}

function choice({
  name,
  value,
  label,
  checked = false,
  disabled = false,
}: {
  name: string;
  value: string;
  label: string;
  checked?: boolean;
  disabled?: boolean;
}): HTMLLabelElement {
  const wrapper = el('label');
  const input = el('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.disabled = disabled;
  wrapper.append(input, ` ${label}`);
  return wrapper;
}
