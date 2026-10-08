import {
  type ArmoryLayer,
  type ArmoryView,
  CLAUDE_AGENT,
  DEFAULT_CLASSES,
  RECOLOR_PRESETS,
  type Recolor,
  type RecolorPreset,
} from '@ibitsa/protocol';
import type { ArmoryTab } from './armory-tab.types';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { Host } from './host.types';
import { readinessLine } from './party-check';
import type { PartyCheck } from './party-check.types';

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

/** One agent as the Armory offers it (#198): its name, and why it can't be picked or won't start. */
export function agentChoice({ view, id }: { view: ArmoryView; id: string }): {
  label: string;
  disabled: boolean;
  warning: string | null;
} {
  if (id === CLAUDE_AGENT) return { label: 'Claude', disabled: false, warning: null };
  const agent = view.agents.find((a) => a.id === id);
  if (!agent) {
    return {
      label: `${id} (unknown)`,
      disabled: true,
      warning: `There's no agent "${id}" in ibitsa.agents: heroes of this class can't start.`,
    };
  }
  if (agent.refused) {
    return { label: `${agent.name} (refused)`, disabled: true, warning: agent.refused };
  }
  if (!agent.found) {
    return {
      label: `${agent.name} (not installed)`,
      disabled: false,
      warning: `${agent.name} isn't installed: \`${agent.command}\` isn't on your PATH. Ibitsa installs no agent; install it and sign in yourself.`,
    };
  }
  return { label: agent.name, disabled: false, warning: null };
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
  partyCheck,
  changed,
}: {
  client: GameClient;
  host: Host;
  /** Checks a class's ACP agent, as party assembly will (#199). */
  partyCheck: PartyCheck;
  changed: () => void;
}): ArmoryTab {
  let view: ArmoryView | null = null;
  let layer: 'user' | 'workspace' = 'user';
  let problem: string | null = null;
  /** The classes whose agents were checked here: their lines show. */
  const checked = new Set<string>();
  host.onHostEvent((event) => {
    if (event.type !== 'armory') return;
    view = event.armory;
    changed();
  });
  partyCheck.onChange(() => {
    if (checked.size > 0) changed();
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
      ...agentList(current),
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
    const agent = agentSelect({ view: v, value: c.agent });
    const model = modelInput({ value: c.model, agent: c.agent });
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
          agent: agent.value,
          ...modelField({ input: model, agent: agent.value, fallback: c.model }),
          appearance: look.value,
        },
        layer,
      });
    name.control.onchange = save;
    // Another agent doesn't run the old one's model: Claude starts on Sonnet, an ACP agent on its own.
    agent.onchange = () => {
      model.value = agent.value === CLAUDE_AGENT ? 'sonnet' : '';
      save();
    };
    model.onchange = save;
    look.onchange = save;
    row.append(
      name.label,
      labelled({ text: 'Agent', control: agent }).label,
      labelled({ text: 'Model', control: model }).label,
      labelled({ text: 'Looks like', control: look }).label,
      el('span', { className: `layer ${c.layer}`, text: LAYERS[c.layer] }),
    );
    const { warning } = agentChoice({ view: v, id: c.agent });
    if (c.agent !== CLAUDE_AGENT) {
      row.append(
        el('p', {
          className: 'note',
          text: "The agent picks the model if it doesn't offer this one, or when none is set.",
        }),
      );
    }
    if (warning) {
      const p = el('p', { className: 'rule-problem', text: warning });
      p.setAttribute('role', 'status');
      row.append(p);
    }
    // The party check, on demand (#199): the agent started once to see that heroes can set out.
    if (c.agent !== CLAUDE_AGENT) {
      if (checked.has(c.id)) row.append(readinessLine({ partyCheck, classId: c.id }));
      else {
        row.append(
          button({
            label: 'Check the agent',
            onClick: () => {
              checked.add(c.id);
              partyCheck.check([c.id]);
            },
          }),
        );
      }
    }
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
    const agent = agentSelect({ view: v, value: CLAUDE_AGENT });
    const model = modelInput({ value: 'sonnet', agent: CLAUDE_AGENT });
    agent.onchange = () => {
      model.value = agent.value === CLAUDE_AGENT ? 'sonnet' : '';
      model.placeholder = agent.value === CLAUDE_AGENT ? '' : 'its default';
    };
    form.append(
      id.label,
      name.label,
      labelled({ text: 'Its agent', control: agent }).label,
      labelled({ text: 'Its model', control: model }).label,
    );
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
          agent: agent.value,
          ...modelField({ input: model, agent: agent.value, fallback: 'sonnet' }),
        },
        layer,
      });
    };
    return form;
  }

  /** The agents a class can run on besides Claude (§11.5), and which are installed (#198). */
  function agentList(v: ArmoryView): HTMLElement[] {
    const list = el('ul', { className: 'armory-agents' });
    for (const a of v.agents) {
      const status = a.refused ?? (a.found ? 'installed' : 'not installed');
      list.append(el('li', { text: `${a.name} (${[a.command, ...a.args].join(' ')}): ${status}` }));
    }
    return [
      el('h3', { text: 'Agents' }),
      el('p', {
        className: 'note',
        text: 'Claude, or an ACP agent you have installed and signed in to. Add or change agents in the ibitsa.agents setting.',
      }),
      list,
    ];
  }

  return {
    load: () => host.request({ channel: 'host', type: 'readArmory' }),
    render,
  };
}

/** Claude and every agent in the view, each labelled with why it can't run (#198). */
function agentSelect({ view, value }: { view: ArmoryView; value: string }): HTMLSelectElement {
  const select = el('select');
  const ids = [CLAUDE_AGENT, ...view.agents.map((a) => a.id)];
  if (!ids.includes(value)) ids.push(value);
  for (const id of ids) {
    const choice = agentChoice({ view, id });
    const option = new Option(choice.label, id);
    option.disabled = choice.disabled && id !== value;
    select.add(option);
  }
  select.value = value;
  return select;
}

function modelInput({ value, agent }: { value: string; agent: string }): HTMLInputElement {
  const input = textInput(value);
  input.setAttribute('list', 'armory-models');
  if (agent !== CLAUDE_AGENT) input.placeholder = 'its default';
  return input;
}

/** The model to write: what's typed, else Claude's fallback; an ACP agent may have none (§11.5). */
function modelField({
  input,
  agent,
  fallback,
}: {
  input: HTMLInputElement;
  agent: string;
  fallback: string;
}): { model?: string } {
  const typed = input.value.trim();
  if (typed) return { model: typed };
  return agent === CLAUDE_AGENT ? { model: fallback || 'sonnet' } : {};
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
