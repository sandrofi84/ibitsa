import type { ExecutionState, HeroView, JournalEntry, Reading, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { HeroPane } from './hero-pane.types';
import { HERO_CLASSES } from './heroes';
import type { Host } from './host.types';
import type { ViewState } from './view-state';

const STATE_LABELS: Record<ExecutionState['kind'], string> = {
  unknown: 'Unknown',
  error: 'Error',
  outOfGold: 'Out of gold',
  stalled: 'Stalled',
  waitingOnYou: 'Waiting on you',
  resting: 'Resting',
  working: 'Working',
  blocked: 'Blocked',
  submitted: 'Submitted',
  idle: 'Waiting for orders',
  traveling: 'Traveling',
};

const OPEN_KEY = 'heroPaneOpen';
const JOURNAL_KEY = 'journalOpen';

/**
 * The hero pane (spec §14.1, §6.3): the quest's hero, its state, and the controls. Plain DOM docked on
 * the right, so everything is reachable by keyboard; it collapses to a tab with the hero's name, a state
 * dot and the "Needs you" count (#61). Open or collapsed is view state.
 */
export function mountHeroPane({
  client,
  host,
  view,
}: {
  client: GameClient;
  host: Host;
  view: ViewState;
}): HeroPane {
  const pane = el('section', { className: 'hero-pane' });
  pane.setAttribute('aria-label', 'Hero');
  pane.hidden = true;
  document.body.appendChild(pane);

  const tab = el('button', { className: 'hero-pane-tab' });
  tab.type = 'button';
  tab.setAttribute('aria-controls', 'hero-pane-body');
  const dot = el('span', { className: 'state-dot' });
  dot.setAttribute('aria-hidden', 'true');
  const tabName = el('span', { className: 'name' });
  const badge = el('span', { className: 'badge' });
  const autoBadge = el('span', { className: 'auto-badge', text: 'AUTO' });
  autoBadge.title = 'Auto mode is on';
  tab.append(dot, tabName, autoBadge, badge);
  const body = el('div', { className: 'hero-pane-body' });
  body.id = 'hero-pane-body';
  pane.append(tab, body);

  let open: boolean = view.get(OPEN_KEY, true);
  let last: Snapshot | null = null;
  const setOpen = (value: boolean) => {
    open = value;
    view.set(OPEN_KEY, value);
    if (last) render(last);
  };
  tab.onclick = () => setOpen(!open);

  // Built once, so typing in the message box survives snapshots.
  const title = el('h2');
  const facts = el('dl');
  const message = el('textarea');
  message.rows = 3;
  message.placeholder = 'Message the hero…';
  message.setAttribute('aria-label', 'Message to the hero');
  // The hero's own summary once it submits: what the "Ready for review!" bubble leads to (#57).
  const summary = el('p', { className: 'summary' });
  summary.hidden = true;
  // Auto mode (#63): a notice while it's on, so it's never on unnoticed.
  const autoNote = el('p', { className: 'auto-note' });
  autoNote.setAttribute('role', 'status');
  const controls = el('div', { className: 'controls' });
  // "Always allow in this project" rules (#62), with a way to take one back.
  const rules = el('section', { className: 'project-rules' });
  rules.setAttribute('aria-label', 'Project rules');
  const status = el('p', { className: 'note' });
  status.setAttribute('role', 'status');
  // The journal (#58): collapsible, newest last, following new lines unless you scrolled up.
  const journal = el('section', { className: 'journal' });
  const journalToggle = el('button', { className: 'journal-toggle', text: 'Journal' });
  journalToggle.type = 'button';
  journalToggle.setAttribute('aria-controls', 'hero-journal');
  const earlier = button({ label: 'Load earlier', onClick: () => client.loadEarlierJournal() });
  earlier.className = 'journal-earlier';
  const lines = el('ol', { className: 'journal-lines' });
  lines.id = 'hero-journal';
  lines.tabIndex = 0;
  lines.setAttribute('aria-label', 'Journal');
  journal.append(journalToggle, earlier, lines);
  let journalOpen: boolean = view.get(JOURNAL_KEY, false);
  journalToggle.onclick = () => {
    journalOpen = !journalOpen;
    view.set(JOURNAL_KEY, journalOpen);
    renderJournal({ follow: true });
  };
  client.onJournal(() => renderJournal({ follow: false }));
  body.append(title, facts, summary, autoNote, message, controls, status, rules, journal);

  let confirmAbandon = false;
  let confirmAuto = false;
  client.onSnapshot((snapshot) => render(snapshot));

  function render(snapshot: Snapshot): void {
    last = snapshot;
    const hero = snapshot.heroes[0];
    const campaign = snapshot.campaign;
    pane.hidden = !hero || !campaign;
    body.hidden = !open;
    // While the pane is open the Needs You panel centres in the space left of it.
    document.body.classList.toggle('hero-pane-open', !pane.hidden && open);
    if (!hero || !campaign) return;
    const waiting = snapshot.needsYou.filter((i) => i.heroId === hero.id).length;
    tabName.textContent = hero.name;
    dot.dataset.state = hero.state.kind;
    badge.textContent = waiting > 0 ? String(waiting) : '';
    badge.hidden = waiting === 0;
    tab.setAttribute('aria-expanded', String(open));
    tab.setAttribute(
      'aria-label',
      `${hero.name}, ${STATE_LABELS[hero.state.kind]}${waiting > 0 ? `, ${waiting} waiting on you` : ''}. ${open ? 'Collapse' : 'Expand'} the hero pane`,
    );
    const auto = campaign.autoApprove;
    autoBadge.hidden = !auto;
    autoNote.hidden = !auto;
    autoNote.textContent = auto
      ? snapshot.sandboxed === false
        ? 'Auto mode is on. There is no sandbox here: every command runs without asking, except writes outside the worktree.'
        : 'Auto mode is on: the hero’s requests are allowed without asking, except outside the worktree or the sandbox.'
      : '';
    const heroClass = HERO_CLASSES.find((c) => c.id === hero.classId);
    title.textContent = hero.name;
    const rows: [string, string][] = [
      ['Class', heroClass ? `${heroClass.label} (${heroClass.model})` : hero.classId],
      ['State', stateText(hero)],
      ['HP', hp(hero.hp)],
      ['Gold', gold(hero.gold)],
      [
        'Quest',
        campaign.status === 'active' ? campaign.title : `${campaign.title} (${campaign.status})`,
      ],
    ];
    if (hero.queuedMessages > 0) rows.push(['Queued', `${hero.queuedMessages} message(s)`]);
    facts.replaceChildren(
      ...rows.flatMap(([k, v]) => {
        // One line each, so the pane keeps its height as the state changes; the full text on hover.
        const value = el('dd', { text: v });
        value.title = v;
        return [el('dt', { text: k }), value];
      }),
    );

    summary.hidden = hero.state.kind !== 'submitted';
    summary.textContent = hero.state.kind === 'submitted' ? hero.state.summary : '';

    const active = campaign.status === 'active';
    const island = snapshot.islands[0];
    message.hidden = !active;
    const send = (priority: 'now' | 'next') => {
      const text = message.value.trim();
      if (!text) return;
      client.send({ type: 'sendMessage', heroId: hero.id, text, priority });
      message.value = '';
    };
    const items: HTMLButtonElement[] = [];
    if (active) {
      items.push(
        button({ label: 'Send', onClick: () => send('next') }),
        button({ label: 'Send now', onClick: () => send('now') }),
        button({
          label: 'Stop',
          onClick: () => client.send({ type: 'stopHero', heroId: hero.id }),
        }),
        button({
          label: 'Rest',
          onClick: () => client.send({ type: 'restHero', heroId: hero.id }),
        }),
      );
      if (hero.state.kind === 'submitted') {
        items.push(
          button({ label: 'Finish quest', onClick: () => client.send({ type: 'finishQuest' }) }),
        );
      } else if (hero.state.kind === 'idle') {
        items.push(
          button({
            label: 'Mark done',
            onClick: () => client.send({ type: 'markDone', heroId: hero.id }),
          }),
        );
      }
      const abandon = button({
        label: confirmAbandon ? 'Really abandon?' : 'Abandon quest',
        onClick: () => {
          if (!confirmAbandon) {
            confirmAbandon = true;
            render(snapshot);
            return;
          }
          confirmAbandon = false;
          client.send({ type: 'abandonQuest' });
        },
      });
      // Its label changes when it asks to confirm; focus follows it by this key.
      abandon.dataset.control = 'abandon';
      items.push(abandon);
      // Turning auto mode on without a sandbox asks once more, saying what that means (#63).
      const autoToggle = button({
        label: auto
          ? 'Turn auto mode off'
          : confirmAuto
            ? 'No sandbox here: turn on anyway?'
            : 'Turn auto mode on',
        onClick: () => {
          if (!auto && snapshot.sandboxed === false && !confirmAuto) {
            confirmAuto = true;
            render(snapshot);
            return;
          }
          confirmAuto = false;
          client.send({ type: 'setAutoApprove', on: !auto });
        },
      });
      autoToggle.dataset.control = 'auto';
      autoToggle.setAttribute('aria-pressed', String(auto));
      items.push(autoToggle);
    }
    const worktree = island?.worktree ?? 'creating';
    if (worktree === 'ready') {
      items.push(
        button({
          label: 'Open worktree',
          onClick: () => host.request({ channel: 'host', type: 'openWorktree' }),
        }),
      );
    }
    if (!active && island && worktree === 'ready') {
      items.push(
        button({
          label: 'Remove worktree',
          onClick: () => client.send({ type: 'removeWorktree', islandId: island.id }),
        }),
      );
    }
    // Keep keyboard focus on the same control across re-renders.
    const key = (b: Element) => (b as HTMLElement).dataset.control ?? b.textContent;
    const focusedEl = document.activeElement;
    const focused = focusedEl && controls.contains(focusedEl) ? key(focusedEl) : null;
    controls.replaceChildren(...items);
    if (focused) items.find((b) => key(b) === focused)?.focus();
    status.textContent = active
      ? ''
      : worktree === 'removed'
        ? `Worktree removed. The branch ${island?.branch ?? ''} is kept.`
        : 'The quest has ended. Its branch is kept.';
    const projectRules = snapshot.projectRules ?? [];
    rules.hidden = projectRules.length === 0;
    rules.replaceChildren(el('h3', { text: 'Always allowed in this project' }), el('ul', {}));
    rules.lastElementChild?.append(
      ...projectRules.map((rule) => {
        const li = el('li');
        const remove = button({ label: 'Remove', onClick: () => client.forgetProjectRule(rule) });
        remove.className = 'rule-remove';
        remove.setAttribute('aria-label', `Remove ${rule}`);
        li.append(el('code', { text: rule }), remove);
        return li;
      }),
    );
    // The first journal page can arrive before the snapshot naming the hero.
    renderJournal({ follow: false });
  }

  function renderJournal({ follow }: { follow: boolean }): void {
    journalToggle.setAttribute('aria-expanded', String(journalOpen));
    lines.hidden = !journalOpen;
    earlier.hidden = !journalOpen || client.journalStart === 0;
    if (!journalOpen) return;
    const heroId = last?.heroes[0]?.id;
    const atEnd = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 8;
    lines.replaceChildren(
      ...client.journal
        .filter((e) => e.heroId === null || e.heroId === heroId)
        .map((e) => journalLine({ entry: e, hero: last?.heroes[0]?.name ?? 'Hero' })),
    );
    if (follow || atEnd) lines.scrollTop = lines.scrollHeight;
  }

  renderJournal({ follow: true });

  return {
    open: () => {
      if (!open) setOpen(true);
      tab.focus();
    },
    element: pane,
  };
}

function stateText(hero: HeroView): string {
  const s = hero.state;
  const label = STATE_LABELS[s.kind];
  if (s.kind === 'working' && hero.activity) {
    return hero.activity.detail
      ? `${label}: ${hero.activity.kind} · ${hero.activity.detail}`
      : `${label}: ${hero.activity.kind}`;
  }
  if (s.kind === 'unknown' || s.kind === 'stalled') return `${label}: ${s.reason}`;
  if (s.kind === 'error') return `${label}: ${s.message}`;
  return label;
}

function hp(reading: Reading<{ used: number; max: number }>): string {
  if (reading.kind === 'unknown') return 'unknown';
  const left = Math.max(0, Math.round(100 * (1 - reading.value.used / reading.value.max)));
  return reading.kind === 'estimated' ? `~${left}%` : `${left}%`;
}

function gold(reading: Reading<number>): string {
  if (reading.kind === 'unknown') return 'unknown';
  const dollars = `$${(reading.value / 1_000_000).toFixed(2)}`;
  return reading.kind === 'estimated' ? `~${dollars}` : dollars;
}

/** One journal line: when, who, and what, by kind. */
function journalLine({ entry, hero }: { entry: JournalEntry; hero: string }): HTMLLIElement {
  const li = el('li', { className: `journal-${entry.kind}` });
  const time = el('time', { text: clock(entry.t) });
  let text: string;
  switch (entry.kind) {
    case 'said':
      text = `${hero}: ${entry.text}`;
      break;
    case 'tool':
      text = `${entry.activity}${entry.detail ? ` · ${entry.detail}` : ''}${entry.outcome === 'failed' ? ' (failed)' : ''}`;
      if (entry.outcome === 'failed') li.classList.add('failed');
      break;
    case 'you':
      text = `You${entry.priority === 'now' ? ' (now)' : ''}: ${entry.text}`;
      break;
    default:
      text = entry.text;
  }
  li.append(time, el('span', { text }));
  return li;
}

/** Minutes and seconds since the campaign started. */
function clock(t: number): string {
  const s = Math.floor(t / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
