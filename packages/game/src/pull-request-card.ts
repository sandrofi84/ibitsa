import type { IslandView, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type {
  PullRequestActions,
  PullRequestCardOptions,
  PullRequestHover,
  PullRequestPanel,
  PullRequestPreview,
} from './pull-request-card.types';
import { cardOf } from './pull-requests';
import type { PullRequestAction } from './pull-requests.types';

/**
 * An island's PR card (spec §5.6, #153): the PR's state and link, what's under way, the last failure,
 * and a button for each thing that can be done now, disabled with the reason when it can't. Every push
 * and PR change is a click here; core checks the rules again.
 */
export function pullRequestCard({ island, onAction }: PullRequestCardOptions): HTMLElement {
  const model = cardOf(island);
  const card = el('section', { className: 'pr-card' });
  card.setAttribute('aria-label', 'Pull request');
  card.append(el('h3', { text: model.heading }));
  const status = el('p', { className: 'pr-status', text: model.status });
  card.append(status);
  if (model.url) {
    // VS Code opens a clicked http(s) link from a webview in the browser.
    const link = el('a', { text: 'Open on GitHub' });
    link.href = model.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const p = el('p');
    p.append(link);
    card.append(p);
  }
  if (model.busy) card.append(el('p', { className: 'note pr-busy', text: model.busy }));
  if (model.restack) card.append(el('p', { className: 'note pr-restack', text: model.restack }));
  if (model.error) {
    const error = el('p', { className: 'pr-error', text: model.error });
    error.setAttribute('role', 'alert');
    card.append(error);
  }
  const buttons = el('div', { className: 'pr-actions' });
  for (const action of model.actions) {
    // A button that asks to confirm says so on the first click and acts on the second.
    let armed = false;
    const b = button({
      label: action.label,
      onClick: () => {
        if (action.confirm && !armed) {
          armed = true;
          b.textContent = action.confirm;
          return;
        }
        onAction(action.id);
      },
    });
    if (action.disabled) {
      b.disabled = true;
      b.title = action.disabled;
    }
    buttons.append(b);
  }
  card.append(buttons);
  const reasons = [...new Set(model.actions.flatMap((a) => (a.disabled ? [a.disabled] : [])))];
  for (const reason of reasons) card.append(el('p', { className: 'note', text: reason }));
  return card;
}

/** What a card's button does: Open PR opens the preview; the rest are commands to core. */
export function actOn({
  actions: { client, preview },
  islandId,
}: {
  actions: PullRequestActions;
  islandId: string;
}): (id: PullRequestAction['id']) => void {
  return (id) => {
    switch (id) {
      case 'open':
        preview.open(islandId);
        return;
      case 'update':
        client.send({ type: 'updatePullRequest', islandId });
        return;
      case 'markReady':
        client.send({ type: 'markPullRequestReady', islandId });
        return;
      case 'push':
        client.send({ type: 'pushBranch', islandId });
        return;
      case 'refresh':
        client.send({ type: 'refreshPullRequests' });
        return;
      case 'comments':
        client.send({ type: 'bringPullRequestComments', islandId });
        return;
      case 'restack':
        client.send({ type: 'restackIsland', islandId });
        return;
      case 'remove':
        client.send({ type: 'removeWorktree', islandId });
        return;
    }
  };
}

/**
 * The preview before a PR opens (§5.6): the title and body, built by core from the record and editable,
 * Draft (ticked and fixed until the island is cleared) and the base, which can't change.
 */
export function mountPullRequestPreview({ client }: { client: GameClient }): PullRequestPreview {
  const form = el('form', { className: 'pr-preview' });
  form.setAttribute('aria-labelledby', 'pr-preview-title');
  form.hidden = true;
  document.body.appendChild(form);
  let islandId: string | null = null;

  const close = () => {
    islandId = null;
    form.hidden = true;
  };
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  // A PR opened (or the island gone) while it's open: nothing left to preview.
  client.onSnapshot((snapshot) => {
    if (islandId && !islandOf(snapshot, islandId)?.pullRequestDraft) close();
  });

  return {
    open: (id) => {
      const draft = client.snapshot && islandOf(client.snapshot, id)?.pullRequestDraft;
      if (!draft) return;
      islandId = id;
      const heading = el('h2', { text: 'Open a pull request' });
      heading.id = 'pr-preview-title';
      const title = el('input');
      title.value = draft.title;
      title.required = true;
      const body = el('textarea');
      body.value = draft.body;
      body.rows = 12;
      const isDraft = el('input');
      isDraft.type = 'checkbox';
      isDraft.checked = draft.draft;
      // Until every task has passed it can only be a draft.
      isDraft.disabled = !draft.cleared;
      const base = el('code', { className: 'pr-base', text: draft.base });
      form.replaceChildren(
        heading,
        labelled({ text: 'Title', control: title }),
        labelled({ text: 'Description', control: body }),
        labelled({ text: 'Draft', control: isDraft }),
        ...(draft.cleared
          ? []
          : [
              el('p', {
                className: 'note',
                text: 'A draft until every task on the island has passed.',
              }),
            ]),
        (() => {
          const p = el('p', { text: 'Into ' });
          p.append(base);
          return p;
        })(),
        ...(draft.cannotOpen ? [el('p', { className: 'pr-error', text: draft.cannotOpen })] : []),
        (() => {
          const row = el('div', { className: 'pr-actions' });
          const submit = el('button', { className: 'pr-button', text: 'Open PR' });
          submit.type = 'submit';
          submit.disabled = draft.cannotOpen !== null;
          const cancel = button({ label: 'Cancel', onClick: close });
          cancel.className = 'pr-button';
          row.append(submit, cancel);
          return row;
        })(),
      );
      form.onsubmit = (e) => {
        e.preventDefault();
        if (!title.value.trim()) return;
        client.send({
          type: 'openPullRequest',
          islandId: id,
          title: title.value.trim(),
          body: body.value,
          draft: isDraft.checked,
        });
        close();
      };
      form.hidden = false;
      title.focus();
    },
    close,
    shown: () => islandId,
  };
}

/** One island's PR card on its own, opened from the island's badge; Esc closes it. */
export function mountPullRequestPanel(actions: PullRequestActions): PullRequestPanel {
  const panel = el('section', { className: 'task-panel pr-panel' });
  panel.setAttribute('aria-label', 'Pull request card');
  panel.hidden = true;
  panel.tabIndex = -1;
  document.body.appendChild(panel);
  let islandId: string | null = null;
  let shownKey = '';

  const close = () => {
    islandId = null;
    shownKey = '';
    panel.hidden = true;
  };
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  const render = (snapshot: Snapshot) => {
    const island = islandId ? islandOf(snapshot, islandId) : undefined;
    if (!island) {
      close();
      return;
    }
    const key = JSON.stringify(island);
    if (key === shownKey) return;
    shownKey = key;
    panel.replaceChildren(
      el('h2', { text: island.name }),
      pullRequestCard({ island, onAction: actOn({ actions, islandId: island.id }) }),
      button({ label: 'Close', onClick: close }),
    );
  };
  actions.client.onSnapshot((snapshot) => {
    if (islandId) render(snapshot);
  });

  return {
    open: (id) => {
      islandId = id;
      shownKey = '';
      panel.hidden = false;
      if (actions.client.snapshot) render(actions.client.snapshot);
      panel.focus();
    },
    close,
    shown: () => islandId,
  };
}

/** The badge's hover: the PR's heading and state beside it; a click opens the full card. */
export function mountPullRequestHover({ client }: { client: GameClient }): PullRequestHover {
  const tip = el('div', { className: 'pr-hover' });
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  return {
    show: ({ islandId, x, y }) => {
      const island = client.snapshot && islandOf(client.snapshot, islandId);
      if (!island) return;
      const model = cardOf(island);
      tip.replaceChildren(
        el('strong', { text: model.heading }),
        el('span', { text: ` · ${model.busy ?? model.status}` }),
      );
      tip.style.left = `${Math.round(x)}px`;
      tip.style.top = `${Math.round(y)}px`;
      tip.hidden = false;
    },
    hide: () => {
      tip.hidden = true;
    },
  };
}

function islandOf(snapshot: Snapshot, islandId: string): IslandView | undefined {
  return snapshot.islands.find((i) => i.id === islandId);
}

function labelled({ text, control }: { text: string; control: HTMLElement }): HTMLLabelElement {
  const label = el('label', { className: 'pr-field', text });
  label.append(control);
  return label;
}
