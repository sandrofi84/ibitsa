import type { HostEvent, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import { DEFAULT_CLASS, defaultHeroName, HERO_CLASSES } from './heroes';
import type { Host } from './host.types';

/**
 * The New Quest form (spec §14.1) and the first-run API-key card (§11.6). Plain DOM in a native
 * <dialog>, so it is keyboard-accessible. Credentials go over the host channel, never the protocol.
 */
export function mountNewQuestForm({ client, host }: { client: GameClient; host: Host }): void {
  const opener = button({ label: 'New quest', onClick: () => open() });
  opener.className = 'new-quest-button';
  opener.hidden = true;
  document.body.appendChild(opener);

  const dialog = el('dialog', { className: 'new-quest' });
  dialog.setAttribute('aria-label', 'New quest');
  document.body.appendChild(dialog);

  let snapshot: Snapshot | null = null;
  let pendingStart: (() => void) | null = null;
  let renderOnboarding: ((error?: string) => void) | null = null;

  const active = () => snapshot?.campaign?.status === 'active';
  client.onSnapshot((s) => {
    snapshot = s;
    opener.hidden = active();
    if (active() && dialog.open) dialog.close();
    if (dialog.open && !renderOnboarding) refreshBranches();
  });

  host.onHostEvent((event: HostEvent) => {
    switch (event.type) {
      case 'openNewQuest':
        open();
        return;
      case 'credentials':
        if (!pendingStart) return;
        if (event.ready) {
          pendingStart();
          pendingStart = null;
        } else {
          showOnboarding();
        }
        return;
      case 'apiKeyAccepted':
        renderOnboarding = null;
        pendingStart?.();
        pendingStart = null;
        return;
      case 'apiKeyRejected':
        renderOnboarding?.(event.reason);
        return;
    }
  });

  // ---------- the form ----------

  const form = el('form');
  const description = el('textarea');
  description.rows = 5;
  description.required = true;
  description.placeholder = 'What should the hero do? The first line becomes the quest title.';
  const classSelect = el('select');
  for (const c of HERO_CLASSES) {
    const option = new Option(`${c.label} (${c.model})`, c.id);
    classSelect.add(option);
  }
  classSelect.value = DEFAULT_CLASS;
  const heroName = el('input');
  heroName.required = true;
  heroName.value = defaultHeroName(DEFAULT_CLASS);
  const nameSuggestions = el('datalist');
  nameSuggestions.id = 'hero-names';
  heroName.setAttribute('list', nameSuggestions.id);
  const baseSelect = el('select');
  const repoNote = el('p', { className: 'note' });
  const error = el('p', { className: 'error' });
  error.setAttribute('role', 'alert');

  let nameEdited = false;
  heroName.oninput = () => {
    nameEdited = true;
  };
  classSelect.onchange = () => {
    if (!nameEdited) heroName.value = defaultHeroName(classSelect.value);
    fillSuggestions();
  };

  const field = (label: string, control: HTMLElement) => {
    const wrapper = el('label');
    wrapper.append(el('span', { text: label }), control);
    return wrapper;
  };
  const start = el('button', { text: 'Start quest' });
  start.type = 'submit';
  form.append(
    el('h2', { text: 'New quest' }),
    field('Task', description),
    field('Hero class', classSelect),
    field('Hero name', heroName),
    nameSuggestions,
    field('Start from branch', baseSelect),
    repoNote,
    error,
    el('div', { className: 'actions' }),
  );
  form.lastElementChild?.append(start, button({ label: 'Cancel', onClick: () => dialog.close() }));

  form.onsubmit = (e) => {
    e.preventDefault();
    error.textContent = '';
    if (active()) {
      error.textContent = 'Finish or abandon the current quest first.';
      return;
    }
    const intent = {
      type: 'startQuest' as const,
      description: description.value.trim(),
      heroName: heroName.value.trim(),
      classId: classSelect.value,
      baseRef: baseSelect.value,
    };
    if (!intent.description || !intent.heroName || !intent.baseRef) return;
    // Ask the extension first: without credentials the onboarding card comes before the quest.
    pendingStart = () => {
      client.send(intent);
      dialog.close();
    };
    host.request({ channel: 'host', type: 'credentialsStatus' });
  };

  function fillSuggestions(): void {
    const names = HERO_CLASSES.find((c) => c.id === classSelect.value)?.names ?? [];
    const label = HERO_CLASSES.find((c) => c.id === classSelect.value)?.label ?? '';
    nameSuggestions.replaceChildren(...names.map((n) => new Option(`${label} ${n}`)));
  }

  function refreshBranches(): void {
    const repo = snapshot?.repo;
    const current = baseSelect.value;
    baseSelect.replaceChildren(...(repo?.branches ?? []).map((b) => new Option(b, b)));
    baseSelect.value = repo?.branches.includes(current) ? current : (repo?.defaultBranch ?? '');
    start.disabled = repo === null;
    if (repo === null) {
      repoNote.textContent =
        "This folder isn't a git repository: a quest needs one for the hero's worktree.";
    } else if (repo === undefined) {
      repoNote.textContent = 'Looking at the repository…';
    } else if (repo.uncommittedChanges > 0) {
      const n = repo.uncommittedChanges;
      repoNote.textContent = `Your ${n} uncommitted change${n === 1 ? '' : 's'} won't be in the hero's worktree.`;
    } else {
      repoNote.textContent = '';
    }
  }

  // ---------- the onboarding card ----------

  function showOnboarding(): void {
    const card = el('form', { className: 'onboarding' });
    const key = el('input');
    key.type = 'password';
    key.autocomplete = 'off';
    key.required = true;
    key.placeholder = 'sk-ant-…';
    const message = el('p', { className: 'error' });
    message.setAttribute('role', 'alert');
    const save = el('button', { text: 'Save key and start' });
    save.type = 'submit';
    card.append(
      el('h2', { text: 'One step before your first quest' }),
      el('p', {
        text: 'Heroes run on your own Anthropic API key. It is stored in VS Code’s secret storage on this machine and used only for your heroes.',
      }),
      button({
        label: 'Get an API key',
        onClick: () => host.request({ channel: 'host', type: 'openApiKeyPage' }),
      }),
      field('Paste your key', key),
      message,
      el('div', { className: 'actions' }),
    );
    card.lastElementChild?.append(
      save,
      button({
        label: 'Back',
        onClick: () => {
          renderOnboarding = null;
          pendingStart = null;
          dialog.replaceChildren(form);
        },
      }),
    );
    card.onsubmit = (e) => {
      e.preventDefault();
      message.textContent = '';
      save.disabled = true;
      host.request({ channel: 'host', type: 'saveApiKey', key: key.value });
    };
    renderOnboarding = (reason) => {
      save.disabled = false;
      if (reason) message.textContent = reason;
    };
    dialog.replaceChildren(card);
    key.focus();
  }

  function open(): void {
    if (active() || dialog.open) return;
    renderOnboarding = null;
    pendingStart = null;
    error.textContent = '';
    dialog.replaceChildren(form);
    fillSuggestions();
    refreshBranches();
    dialog.showModal();
    description.focus();
  }
}
