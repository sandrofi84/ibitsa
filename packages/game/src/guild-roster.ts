import type { CouncillorInfo, CouncillorOverride, CouncilSettingsView } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { NewCouncillorDraft, RosterTab } from './guild-roster.types';
import type { Host } from './host.types';

const SOURCES: Record<CouncillorInfo['source'], string> = {
  builtin: 'Built-in',
  user: 'Yours',
  project: 'This project',
};

const LAYERS: Record<CouncilSettingsView['overridesLayer'], string> = {
  default: 'Default',
  user: 'You',
  workspace: 'This project',
};

/** What a councillor does, in words: plans, reviews, or both. */
export function modesText(modes: CouncillorInfo['modes']): string {
  if (modes.planning && modes.review) return 'Plans and reviews';
  return modes.review ? 'Reviews only' : 'Plans only';
}

/** Where a councillor's skill comes from, in words. */
export function sourceLabel(source: CouncillorInfo['source']): string {
  return SOURCES[source];
}

/** A councillor's overrides with one field changed; an empty field drops it. */
export function withField({
  override,
  field,
  value,
}: {
  override: CouncillorOverride | undefined;
  field: 'title' | 'model';
  value: string;
}): CouncillorOverride | null {
  const { [field]: _old, ...rest } = override ?? {};
  const next: CouncillorOverride = value.trim() ? { ...rest, [field]: value.trim() } : rest;
  return Object.keys(next).length > 0 ? next : null;
}

/** Why a new councillor can't be written yet, or null when it can. */
export function draftProblem({
  draft,
  taken,
}: {
  draft: NewCouncillorDraft;
  taken: readonly string[];
}): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(draft.id))
    return 'The id is lowercase letters, digits and hyphens, e.g. performance.';
  if (taken.includes(draft.id)) return `There's already a councillor called ${draft.id}.`;
  if (!draft.title.trim()) return 'Give it a title.';
  if (!draft.description.trim()) return 'Say what its field is.';
  return null;
}

/**
 * The Guild Hall's Roster (§4.7, #181): every councillor with where it comes from, what it does and
 * its model; switched on or off, extended with overrides, customised (its skill copied to edit), or
 * written new from a template. Everything goes to the extension, which keeps VS Code's settings and the
 * skill files.
 */
export function mountRoster({
  client,
  host,
  onChange,
}: {
  client: GameClient;
  host: Host;
  onChange: () => void;
}): RosterTab {
  let settings: CouncilSettingsView | null = null;
  let layer: 'user' | 'workspace' = 'user';
  let problem: string | null = null;
  const draft: NewCouncillorDraft = { id: '', title: '', description: '' };
  host.onHostEvent((event) => {
    if (event.type !== 'councilSettings') return;
    settings = event.council;
    onChange();
  });
  client.onSnapshot(() => onChange());

  function render(): HTMLElement[] {
    const snapshot = client.snapshot;
    const roster = snapshot?.roster ?? snapshot?.councillors ?? [];
    const where = el('select');
    where.setAttribute('aria-label', 'Save roster changes to');
    where.add(new Option('your settings', 'user'));
    where.add(new Option("this project's", 'workspace'));
    where.value = layer;
    where.onchange = () => {
      layer = where.value as 'user' | 'workspace';
    };
    const top = el('p', { className: 'note', text: 'Save changes to ' });
    top.append(where, '.');
    if (!settings) return [top, el('p', { text: 'Reading the roster…' })];
    const list = el('ul', { className: 'roster' });
    for (const c of roster) list.append(card({ c, settings }));
    if (roster.length === 0) list.append(el('li', { text: 'No councillors found.' }));
    return [top, list, newCouncillor(roster)];
  }

  function card({ c, settings: s }: { c: CouncillorInfo; settings: CouncilSettingsView }) {
    const li = el('li', { className: 'entry councillor-card' });
    li.setAttribute('aria-label', c.title);
    const on = el('input');
    on.type = 'checkbox';
    on.checked = !s.disabled.includes(c.id);
    on.onchange = () =>
      host.request({
        channel: 'host',
        type: 'setCouncillorEnabled',
        id: c.id,
        enabled: on.checked,
        layer,
      });
    const sits = el('label', { className: 'sits' });
    sits.append(on, ' Sits on the council');
    const override = s.overrides[c.id];
    const fields = (['title', 'model'] as const).map((field) => {
      const input = el('input');
      input.value = override?.[field] ?? '';
      input.placeholder = field === 'title' ? c.title : (c.model ?? 'the effort decides');
      input.onchange = () =>
        host.request({
          channel: 'host',
          type: 'setCouncillorOverride',
          id: c.id,
          override: withField({ override, field, value: input.value }),
          layer,
        });
      const label = el('label', {
        className: 'override',
        text: field === 'title' ? 'Title ' : 'Model ',
      });
      label.append(input);
      return label;
    });
    const head = el('div', { className: 'councillor-head' });
    head.append(
      el('strong', { text: c.title }),
      ' ',
      el('code', { text: c.id }),
      ' ',
      el('span', { className: 'layer', text: sourceLabel(c.source) }),
    );
    li.append(
      head,
      el('p', {
        className: 'note',
        text: `${modesText(c.modes)} · ${c.model ?? 'the effort decides the model'}${c.description ? ` · ${c.description}` : ''}`,
      }),
      sits,
      ...fields,
    );
    if (override) {
      const from = s.overridesLayer;
      li.append(
        el('span', { className: `layer ${from}`, text: `Extended: ${LAYERS[from]}` }),
        ...(from === 'default'
          ? []
          : [
              button({
                label: 'Reset',
                onClick: () =>
                  host.request({
                    channel: 'host',
                    type: 'setCouncillorOverride',
                    id: c.id,
                    override: null,
                    layer: from,
                  }),
              }),
            ]),
      );
    }
    const customise = button({
      label: 'Customise',
      onClick: () => {
        if (c.path)
          host.request({
            channel: 'host',
            type: 'customiseCouncillor',
            id: c.id,
            path: c.path,
            layer,
          });
      },
    });
    customise.disabled = !c.path;
    customise.title = 'Copy its skill to edit it; your copy replaces this one.';
    li.append(customise);
    return li;
  }

  function newCouncillor(roster: CouncillorInfo[]): HTMLElement {
    const form = el('form', { className: 'new-councillor' });
    form.setAttribute('aria-label', 'New councillor');
    const inputs = (['id', 'title', 'description'] as const).map((key) => {
      const input = el('input');
      input.value = draft[key];
      input.oninput = () => {
        draft[key] = input.value;
      };
      const label = el('label', {
        text: key === 'id' ? 'Id ' : key === 'title' ? 'Title ' : 'Field ',
      });
      label.append(input);
      return label;
    });
    const write = el('button', { text: 'Write the skill' });
    write.type = 'submit';
    form.onsubmit = (e) => {
      e.preventDefault();
      problem = draftProblem({ draft, taken: roster.map((c) => c.id) });
      if (!problem) {
        host.request({
          channel: 'host',
          type: 'newCouncillor',
          id: draft.id,
          title: draft.title.trim(),
          description: draft.description.trim(),
          layer,
        });
        draft.id = '';
        draft.title = '';
        draft.description = '';
      }
      onChange();
    };
    form.append(el('h3', { text: 'New councillor' }), ...inputs, write);
    if (problem) {
      const p = el('p', { className: 'rule-problem', text: problem });
      p.setAttribute('role', 'alert');
      form.append(p);
    }
    return form;
  }

  return {
    refresh: () => host.request({ channel: 'host', type: 'readCouncilSettings' }),
    render,
  };
}
