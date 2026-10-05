import type { ExecutionState, HeroView, Reading, Snapshot } from '@ibitsa/protocol';
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
  tab.append(dot, tabName, badge);
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
  const controls = el('div', { className: 'controls' });
  const status = el('p', { className: 'note' });
  status.setAttribute('role', 'status');
  body.append(title, facts, message, controls, status);

  let confirmAbandon = false;
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
  }

  return {
    open: () => {
      if (!open) setOpen(true);
      tab.focus();
    },
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
