import {
  type ArmoryLayer,
  type ArmoryView,
  DEFAULT_CLASSES,
  RECOLOR_PRESETS,
  type Recolor,
  type RecolorPreset,
} from '@ibitsa/protocol';
import type { ArmoryTab } from './armory-tab.types';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { Host } from './host.types';

const LAYERS: Record<ArmoryLayer, string> = {
  default: 'Default',
  user: 'You',
  workspace: 'This project',
};
/** Model aliases offered as you type; any model id works. */
const MODELS = ['fable', 'opus', 'sonnet', 'haiku'];

/** Why a new class can't be added with this id, or null when it can. */
export function newClassProblem({
  id,
  taken,
}: {
  id: string;
  taken: readonly string[];
}): string | null {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(id)) return 'A lowercase word, e.g. bard.';
  if (taken.includes(id)) return 'That class exists already: edit it above.';
  return null;
}

/** The appearances a class can take: the built-ins' characters and any in use. */
export function appearances(view: ArmoryView): string[] {
  return [
    ...new Set([
      ...DEFAULT_CLASSES.map((c) => c.appearance),
      ...view.classes.map((c) => c.appearance),
    ]),
  ];
}

/**
 * The Guild Hall's Armory (§5.2, §7.1, #182): the hero classes, each with its name, model and
 * appearance, a recolor per class and per councillor, and a new class. Every change is written through
 * the host to your settings or the project's, one entry at a time, with Reset like the Rule book.
 */
export function armoryTab({
  client,
  host,
  changed,
}: {
  client: GameClient;
  host: Host;
  changed: () => void;
}): ArmoryTab {
  let view: ArmoryView | null = null;
  let layer: 'user' | 'workspace' = 'user';
  let problem: string | null = null;
  host.onHostEvent((event) => {
    if (event.type !== 'armory') return;
    view = event.armory;
    changed();
  });

  function render(): HTMLElement[] {
    if (!view) return [el('p', { text: 'Reading the Armory…' })];
    const where = el('select');
    where.setAttribute('aria-label', 'Save Armory changes to');
    where.add(new Option('your settings', 'user'));
    where.add(new Option("this project's settings", 'workspace'));
    where.value = layer;
    where.onchange = () => {
      layer = where.value as 'user' | 'workspace';
    };
    const top = el('p', { className: 'note', text: 'Save changes to ' });
    top.append(where, '.');
    const models = el('datalist');
    models.id = 'armory-models';
    for (const m of MODELS) models.append(new Option(m));
    const current = view;
    return [
      top,
      models,
      el('h3', { text: 'Classes' }),
      ...current.classes.map((c) => classRow({ c, view: current })),
      addClass(current),
      el('h3', { text: 'Councillors' }),
      ...(client.snapshot?.councillors ?? []).map((c) =>
        recolorRow({ target: `councillor:${c.id}`, label: c.title, view: current }),
      ),
    ];
  }

  function classRow({
    c,
    view: v,
  }: {
    c: ArmoryView['classes'][number];
    view: ArmoryView;
  }): HTMLElement {
    const row = el('fieldset', { className: 'armory-class' });
    row.append(el('legend', { text: c.name }));
    const name = labelled({ text: 'Name', control: textInput(c.name) });
    const model = textInput(c.model);
    model.setAttribute('list', 'armory-models');
    const look = el('select');
    for (const a of appearances(v)) look.add(new Option(a.replace(/^hero\./, ''), a));
    look.value = c.appearance;
    const save = () =>
      host.request({
        channel: 'host',
        type: 'writeClass',
        id: c.id,
        class: {
          name: name.control.value.trim() || c.name,
          model: model.value.trim() || c.model,
          appearance: look.value,
        },
        layer,
      });
    name.control.onchange = save;
    model.onchange = save;
    look.onchange = save;
    row.append(
      name.label,
      labelled({ text: 'Model', control: model }).label,
      labelled({ text: 'Looks like', control: look }).label,
      el('span', { className: `layer ${c.layer}`, text: LAYERS[c.layer] }),
    );
    if (c.layer !== 'default') {
      const from = c.layer;
      row.append(
        button({
          label: c.builtIn ? 'Reset' : 'Remove',
          onClick: () =>
            host.request({ channel: 'host', type: 'resetClass', id: c.id, layer: from }),
        }),
      );
    }
    row.append(recolorRow({ target: `class:${c.id}`, label: 'Recolor', view: v }));
    return row;
  }

  function recolorRow({
    target,
    label,
    view: v,
  }: {
    target: string;
    label: string;
    view: ArmoryView;
  }): HTMLElement {
    const entry = v.recolor.find((r) => r.target === target);
    const recolor: Recolor = entry?.recolor ?? { hue: 0, preset: 'none' };
    const row = el('div', { className: 'armory-recolor' });
    const hue = el('input');
    hue.type = 'range';
    hue.min = '-180';
    hue.max = '180';
    hue.step = '15';
    hue.value = String(recolor.hue);
    const preset = el('select');
    for (const p of RECOLOR_PRESETS) preset.add(new Option(p, p));
    preset.value = recolor.preset;
    const save = () =>
      host.request({
        channel: 'host',
        type: 'writeRecolor',
        target,
        recolor: { hue: Number(hue.value), preset: preset.value as RecolorPreset },
        layer,
      });
    hue.onchange = save;
    preset.onchange = save;
    row.append(
      el('span', { text: label }),
      labelled({ text: `Hue of ${target}`, control: hue, hidden: true }).label,
      labelled({ text: `Palette of ${target}`, control: preset, hidden: true }).label,
    );
    if (entry && entry.layer !== 'default') {
      const from = entry.layer;
      row.append(
        el('span', { className: `layer ${from}`, text: LAYERS[from] }),
        button({
          label: 'Reset',
          onClick: () =>
            host.request({ channel: 'host', type: 'resetRecolor', target, layer: from }),
        }),
      );
    }
    return row;
  }

  function addClass(v: ArmoryView): HTMLElement {
    const form = el('form', { className: 'armory-new' });
    const id = labelled({ text: 'New class id', control: textInput('') });
    const name = labelled({ text: 'Its name', control: textInput('') });
    const model = textInput('sonnet');
    model.setAttribute('list', 'armory-models');
    form.append(id.label, name.label, labelled({ text: 'Its model', control: model }).label);
    form.append(el('button', { text: 'Add the class' }));
    if (problem) {
      const p = el('p', { className: 'rule-problem', text: problem });
      p.setAttribute('role', 'alert');
      form.append(p);
    }
    form.onsubmit = (e) => {
      e.preventDefault();
      const newId = id.control.value.trim();
      problem = newClassProblem({ id: newId, taken: v.classes.map((c) => c.id) });
      if (problem) {
        changed();
        return;
      }
      host.request({
        channel: 'host',
        type: 'writeClass',
        id: newId,
        class: {
          ...(name.control.value.trim() ? { name: name.control.value.trim() } : {}),
          model: model.value.trim() || 'sonnet',
        },
        layer,
      });
    };
    return form;
  }

  return {
    load: () => host.request({ channel: 'host', type: 'readArmory' }),
    render,
  };
}

function textInput(value: string): HTMLInputElement {
  const input = el('input');
  input.value = value;
  return input;
}

function labelled<T extends HTMLElement>({
  text,
  control,
  hidden = false,
}: {
  text: string;
  control: T;
  hidden?: boolean;
}): { label: HTMLLabelElement; control: T } {
  const label = el('label', { className: hidden ? 'armory-field quiet' : 'armory-field' });
  if (hidden) control.setAttribute('aria-label', text);
  else label.append(`${text} `);
  label.append(control);
  return { label, control };
}
