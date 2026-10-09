import {
  type ChronicleEntry,
  type PackView,
  RULE_BOOK,
  type RuleKey,
  type SettingKey,
  type SettingValue,
  type SettingView,
} from '@ibitsa/protocol';
import { armoryTab } from './armory-tab';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { GuildHall, GuildTab } from './guild-hall.types';
import { packsTab } from './guild-packs';
import { mountRoster } from './guild-roster';
import type { Host } from './host.types';
import type { PartyCheck } from './party-check.types';

const TABS: { id: GuildTab; label: string }[] = [
  { id: 'roster', label: 'Roster' },
  { id: 'rules', label: 'Rule book' },
  { id: 'armory', label: 'Armory' },
  { id: 'spells', label: 'Spell book' },
  { id: 'chronicle', label: 'Chronicle' },
  { id: 'packs', label: 'Packs' },
];

const RULE_TITLES: Record<RuleKey, string> = {
  'review.loopLimit': 'Review rounds before you decide',
  checks: 'Checks',
  'parties.maxParallel': 'Parties at once',
  'hero.budgetUsd': "A hero's gold pouch ($)",
  'campaign.budgetUsd': "A campaign's cap ($)",
  'elder.model': "The elder's model",
  'elder.budgetUsd': "The elder's cap ($)",
  'council.mode': 'How the council sits',
  'council.consultBudgetUsd': 'A question to the council ($)',
  'council.sittingBudgetUsd': 'A sitting of the council ($)',
  'council.reviewBudgetUsd': 'One review ($)',
  'council.lessonsBudgetUsd': 'The lessons at the end ($)',
  'pullRequests.pollSeconds': 'Pull request polling (seconds)',
  'worktree.setup': 'Worktree setup command',
};

const LAYERS: Record<SettingView['layer'], string> = {
  default: 'Default',
  user: 'You',
  workspace: 'This project',
};

/** A rule's title as the Rule book shows it. */
export function ruleTitle(key: RuleKey): string {
  return RULE_TITLES[key];
}

/** A rule's value as its input shows it: a list one per line, none as an empty field. */
export function ruleText(value: SettingValue): string {
  if (value === null) return '';
  return Array.isArray(value) ? value.join('\n') : String(value);
}

/**
 * What the user typed, as the rule's value; an empty field is none where the rule allows it, else the
 * reason it can't be saved.
 */
export function parseRule({
  rule,
  text,
}: {
  rule: SettingView;
  text: string;
}): { ok: true; value: SettingValue } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '' && rule.kind !== 'text') {
    return rule.nullable ? { ok: true, value: null } : { ok: false, reason: 'This needs a value.' };
  }
  switch (rule.kind) {
    case 'integer':
    case 'number': {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || (rule.kind === 'integer' && !Number.isInteger(n)))
        return {
          ok: false,
          reason: rule.kind === 'integer' ? 'A whole number, please.' : 'A number, please.',
        };
      if (rule.minimum !== undefined && n < rule.minimum)
        return { ok: false, reason: `At least ${rule.minimum}.` };
      return { ok: true, value: n };
    }
    case 'list':
      return {
        ok: true,
        value: trimmed
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean),
      };
    case 'choice':
      return rule.choices?.includes(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: 'Choose one of the options.' };
    case 'text':
      return { ok: true, value: text };
    case 'toggle':
      return { ok: true, value: trimmed === 'true' };
  }
}

/** A rule of the Rule book, not a volume (the Packs tab has those, #184). */
export function isRule(view: SettingView): view is SettingView & { key: RuleKey } {
  return (RULE_BOOK as readonly string[]).includes(view.key);
}

/**
 * The Guild Hall (§7.1, #179): Ibitsa's settings in Home Village. The Rule book edits VS Code's own
 * settings through the host, at your layer or the project's; the Spell book lists the actions; the
 * Chronicle lists past campaigns. Esc closes it.
 */
export function mountGuildHall({
  client,
  host,
  partyCheck,
}: {
  client: GameClient;
  host: Host;
  /** The Armory checks a class's ACP agent (#199). */
  partyCheck: PartyCheck;
}): GuildHall {
  const panel = el('section', { className: 'guild-hall' });
  panel.setAttribute('aria-label', 'Guild Hall');
  panel.hidden = true;
  panel.tabIndex = -1;
  document.body.appendChild(panel);
  let tab: GuildTab | null = null;
  let rules: SettingView[] = [];
  let layer: 'user' | 'workspace' = 'user';
  const problems = new Map<SettingKey, string>();

  const close = () => {
    tab = null;
    panel.hidden = true;
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  let packs: PackView[] | null = null;
  let activePack = 'default';
  host.onHostEvent((event) => {
    if (event.type === 'packs') {
      packs = event.packs;
      activePack = event.active;
      if (tab === 'packs') render();
      return;
    }
    if (event.type !== 'settings') return;
    rules = event.rules;
    if (tab === 'rules' || tab === 'packs') render();
  });
  client.onChronicle(() => {
    if (tab === 'chronicle') render();
  });
  const armory = armoryTab({
    client,
    host,
    partyCheck,
    changed: () => {
      if (tab === 'armory') render();
    },
  });
  client.onActions(() => {
    if (tab === 'spells') render();
  });
  const roster = mountRoster({
    client,
    host,
    onChange: () => {
      if (tab === 'roster') render();
    },
  });

  const show = (next: GuildTab) => {
    tab = next;
    if (next === 'roster') roster.refresh();
    if (next === 'rules') host.request({ channel: 'host', type: 'readSettings' });
    if (next === 'chronicle') client.requestChronicle();
    if (next === 'spells') client.requestActions();
    if (next === 'packs') {
      host.request({ channel: 'host', type: 'readPacks' });
      host.request({ channel: 'host', type: 'readSettings' });
    }
    if (next === 'armory') armory.load();
    render();
  };

  function render(): void {
    if (!tab) return;
    const tabs = el('div', { className: 'guild-tabs' });
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = button({ label: t.label, onClick: () => show(t.id) });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.id === tab));
      tabs.append(b);
    }
    const body = el('div', { className: 'guild-body' });
    body.setAttribute('role', 'tabpanel');
    body.append(...tabBody(tab));
    panel.replaceChildren(
      el('h2', { text: 'Guild Hall' }),
      tabs,
      body,
      button({ label: 'Close', onClick: close }),
    );
  }

  function tabBody(t: GuildTab): HTMLElement[] {
    switch (t) {
      case 'roster':
        return roster.render();
      case 'rules':
        return ruleBook();
      case 'armory':
        return armory.render();
      case 'spells':
        return spellBook();
      case 'chronicle':
        return chronicle();
      case 'packs':
        return packsTab({
          packs,
          active: activePack,
          onUse: (id) => host.request({ channel: 'host', type: 'usePack', id }),
          sound: {
            levels: rules.filter((r) => !isRule(r)),
            onChange: (key, value) =>
              host.request({ channel: 'host', type: 'writeSetting', key, value, layer: 'user' }),
          },
        });
    }
  }

  function ruleBook(): HTMLElement[] {
    const where = el('select');
    where.setAttribute('aria-label', 'Save changes to');
    where.add(new Option('your settings', 'user'));
    where.add(new Option("this project's settings", 'workspace'));
    where.value = layer;
    where.onchange = () => {
      layer = where.value as 'user' | 'workspace';
    };
    const top = el('p', { className: 'note', text: 'Save changes to ' });
    top.append(where, '.');
    const vscodeSettings = button({
      label: 'Open VS Code settings',
      onClick: () => host.request({ channel: 'host', type: 'openSettings' }),
    });
    if (rules.length === 0) return [top, el('p', { text: 'Reading the rules…' }), vscodeSettings];
    return [top, ...rules.filter(isRule).map(ruleRow), vscodeSettings];
  }

  function ruleRow(rule: SettingView & { key: RuleKey }): HTMLElement {
    const row = el('div', { className: 'rule' });
    const id = `rule-${rule.key.replaceAll('.', '-')}`;
    const label = el('label', { text: ruleTitle(rule.key) });
    label.htmlFor = id;
    const input = inputFor(rule);
    input.id = id;
    const save = () => {
      const parsed = parseRule({ rule, text: input.value });
      if (!parsed.ok) {
        problems.set(rule.key, parsed.reason);
        render();
        return;
      }
      problems.delete(rule.key);
      host.request({
        channel: 'host',
        type: 'writeSetting',
        key: rule.key,
        value: parsed.value,
        layer,
      });
    };
    input.onchange = save;
    const source = el('span', { className: `layer ${rule.layer}`, text: LAYERS[rule.layer] });
    row.append(label, input, source);
    if (rule.layer !== 'default') {
      const from = rule.layer;
      row.append(
        button({
          label: 'Reset',
          onClick: () =>
            host.request({ channel: 'host', type: 'resetSetting', key: rule.key, layer: from }),
        }),
      );
    }
    row.append(el('p', { className: 'note', text: rule.description }));
    const problem = problems.get(rule.key);
    if (problem) {
      const p = el('p', { className: 'rule-problem', text: problem });
      p.setAttribute('role', 'alert');
      row.append(p);
    }
    return row;
  }

  function spellBook(): HTMLElement[] {
    const actions = client.actions;
    if (actions.length === 0) return [el('p', { text: 'No actions yet.' })];
    const list = el('ul', { className: 'spells' });
    for (const a of actions) {
      const li = el('li', { className: 'entry' });
      li.append(
        el('code', { text: `/${a.name}` }),
        ` ${a.description} `,
        el('span', { className: 'note', text: `(${a.source})` }),
      );
      list.append(li);
    }
    return [list];
  }

  function chronicle(): HTMLElement[] {
    const campaigns = client.chronicle;
    if (campaigns === null) return [el('p', { text: 'Reading the Chronicle…' })];
    if (campaigns.length === 0) return [el('p', { text: 'No past campaigns yet.' })];
    const list = el('ul', { className: 'chronicle' });
    for (const c of campaigns) list.append(chronicleEntry(c));
    return [list];
  }

  function chronicleEntry(c: ChronicleEntry): HTMLElement {
    const li = el('li', { className: 'entry' });
    li.append(
      el('strong', { text: c.title }),
      ` ${c.date} · ${c.status === 'finished' ? 'finished' : 'abandoned'}`,
      ...(c.gold === null ? [] : [` · $${(c.gold / 1_000_000).toFixed(2)}`]),
    );
    if (c.summary) li.append(el('p', { className: 'note', text: c.summary }));
    for (const pr of c.pullRequests) {
      const a = el('a', { text: `#${pr.number} ${pr.state}` });
      a.href = pr.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.append(' ', a);
    }
    li.append(
      ' ',
      button({
        label: 'Open record',
        onClick: () => host.request({ channel: 'host', type: 'openFile', path: c.path }),
      }),
    );
    return li;
  }

  return {
    open: (next = 'rules') => {
      panel.hidden = false;
      show(next);
      panel.focus();
    },
    close,
    shown: () => tab,
  };
}

function inputFor(rule: SettingView): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (rule.kind === 'choice') {
    const select = el('select');
    for (const c of rule.choices ?? []) select.add(new Option(c, c));
    select.value = ruleText(rule.value);
    return select;
  }
  if (rule.kind === 'list') {
    const area = el('textarea');
    area.rows = 3;
    area.value = ruleText(rule.value);
    area.placeholder = rule.nullable ? 'None: one command per line' : 'One per line';
    return area;
  }
  const input = el('input');
  input.value = ruleText(rule.value);
  if (rule.kind !== 'text') input.inputMode = 'decimal';
  if (rule.nullable) input.placeholder = 'None';
  return input;
}
