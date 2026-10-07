import type {
  CheckResult,
  Finding,
  Snapshot,
  TaskPointView,
  TaskReviewView,
} from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import { actOn, pullRequestCard } from './pull-request-card';
import type { PullRequestActions } from './pull-request-card.types';
import { councillorTitle } from './sitting-hut';
import type { TaskPanel } from './task-panel.types';
import { findingLine, phaseText, roundsOf } from './task-review';

const STATES: Record<TaskPointView['state'], string> = {
  locked: 'Not started',
  active: 'In progress',
  underReview: 'Under review',
  done: 'Done',
  doneUnreviewed: 'Done (not reviewed)',
};

/**
 * The task panel (spec §5.5, §7.2; #141): opened from a task point on the map or the hero pane, it shows
 * the task's check results, each reviewer's verdict and findings per round, and the suggestions kept for
 * the pull request, then its island's PR card (#153). Plain DOM, keyboard-accessible; Esc closes it.
 */
export function mountTaskPanel({
  client,
  pullRequests,
}: {
  client: GameClient;
  pullRequests: PullRequestActions;
}): TaskPanel {
  const panel = el('section', { className: 'task-panel' });
  // Named by its heading, the task's title.
  panel.setAttribute('aria-labelledby', 'task-panel-title');
  panel.hidden = true;
  panel.tabIndex = -1;
  document.body.appendChild(panel);
  let taskPointId: string | null = null;
  let shownKey = '';

  const close = () => {
    taskPointId = null;
    shownKey = '';
    panel.hidden = true;
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  client.onSnapshot((snapshot) => {
    if (taskPointId) render(snapshot);
  });

  function render(snapshot: Snapshot): void {
    const island = snapshot.islands.find((i) => i.taskPoints.some((tp) => tp.id === taskPointId));
    const task = island?.taskPoints.find((tp) => tp.id === taskPointId);
    if (!island || !task) {
      close();
      return;
    }
    // Rebuild only when what it shows changes, so an opened output stays open between snapshots.
    const key = JSON.stringify([task, island.remote, island.pullRequestDraft, snapshot.gitHost]);
    if (key === shownKey) return;
    shownKey = key;
    const heading = el('h2', { text: task.title });
    heading.id = 'task-panel-title';
    const state = el('p', {
      className: 'task-state',
      text: task.review ? `${STATES[task.state]}: ${phaseText(task.review)}` : STATES[task.state],
    });
    panel.replaceChildren(
      heading,
      state,
      ...(task.review
        ? reviewParts(task.review)
        : [el('p', { className: 'note', text: 'Not submitted yet.' })]),
      pullRequestCard({
        island,
        host: snapshot.gitHost,
        onAction: actOn({ actions: pullRequests, islandId: island.id }),
      }),
      button({ label: 'Close', onClick: close }),
    );
  }

  return {
    open: (id) => {
      taskPointId = id;
      shownKey = '';
      panel.hidden = false;
      const snapshot = client.snapshot;
      if (snapshot) render(snapshot);
      panel.focus();
    },
    close,
    shown: () => taskPointId,
  };
}

function reviewParts(review: TaskReviewView): HTMLElement[] {
  const parts: HTMLElement[] = [el('h3', { text: 'Checks' })];
  parts.push(
    review.checks ? checksList(review.checks) : el('p', { className: 'note', text: 'Running…' }),
  );
  const rounds = roundsOf(review);
  if (rounds.length > 0) {
    parts.push(el('h3', { text: 'Reviews' }));
    for (const round of rounds) {
      const section = el('section', { className: 'round' });
      section.setAttribute('aria-label', `Round ${round.round}`);
      section.append(el('h4', { text: `Round ${round.round}` }));
      const list = el('ul', { className: 'reviews' });
      for (const r of round.reviews) {
        const li = el('li');
        const who = councillorTitle(r.councillorId);
        const verdict =
          r.status === 'running'
            ? 'reviewing…'
            : r.status === 'failed'
              ? `couldn't finish: ${r.error ?? 'no reason given'}`
              : r.verdict?.verdict === 'pass'
                ? 'passed'
                : 'asks for changes';
        li.append(el('strong', { text: who }), ` ${verdict}`);
        const findings = r.verdict?.findings ?? [];
        if (findings.length > 0) li.append(findingsList(findings));
        list.append(li);
      }
      section.append(list);
      parts.push(section);
    }
  }
  parts.push(el('h3', { text: 'Suggestions' }));
  if (review.suggestions.length === 0) {
    parts.push(el('p', { className: 'note', text: 'None so far.' }));
  } else {
    const list = findingsList(review.suggestions, { by: true });
    list.setAttribute('aria-label', 'Suggestions');
    parts.push(list, el('p', { className: 'note', text: 'Kept for the pull request.' }));
  }
  return parts;
}

function checksList(checks: CheckResult[]): HTMLElement {
  if (checks.length === 0) return el('p', { className: 'note', text: 'No checks configured.' });
  const list = el('ul', { className: 'checks' });
  list.setAttribute('aria-label', 'Checks');
  for (const c of checks) {
    const li = el('li', { className: c.ok ? 'pass' : 'fail' });
    const details = el('details');
    const summary = el('summary');
    summary.append(el('code', { text: c.command }), ` ${c.ok ? 'passed' : 'failed'}`);
    details.append(summary, el('pre', { text: c.output || '(no output)' }));
    // A failure opens with its output showing.
    details.open = !c.ok;
    li.append(details);
    list.append(li);
  }
  return list;
}

function findingsList(
  findings: (Finding & { councillorId?: string })[],
  { by = false }: { by?: boolean } = {},
): HTMLElement {
  const list = el('ul', { className: 'findings' });
  for (const f of findings) {
    const line = findingLine(f);
    const li = el('li', { className: f.severity });
    li.append(el('span', { className: 'severity', text: line.severity }));
    if (by && f.councillorId) li.append(` (${councillorTitle(f.councillorId)})`);
    if (line.why) li.append(` · ${line.why}`);
    if (line.where) li.append(' · ', el('code', { text: line.where }));
    li.append(` · ${line.message}`);
    if (line.revisit) li.append(el('span', { className: 'revisit', text: ` · ${line.revisit}` }));
    list.append(li);
  }
  return list;
}
