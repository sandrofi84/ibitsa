import type { HostEvent, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import { DEFAULT_CLASS, defaultHeroName, heroClasses } from './heroes';
import type { Host } from './host.types';
import { ELDER } from './hut-view';
import type { NewQuestForm } from './new-quest-form.types';
import { AGENTS_NOT_READY, readinessLine } from './party-check';
import type { PartyCheck } from './party-check.types';
import { recolorFilter, recolorOf } from './recolor';
import { councillorAppearance } from './sitting-hut';

/** The welcome's two ways to start (#270): labels that say what happens. */
export const ASK_LABEL = 'Ask the elder to research it first';
export const QUICK_LABEL = 'Start a quick quest now';
const ASK_CHOICE = {
  label: 'Ask the elder:',
  text: 'the elder reads the code and writes a short brief, in about a minute, for a few cents. Then you choose a quick quest or the council.',
};
const QUICK_CHOICE = {
  label: 'Quick quest:',
  text: 'you pick a hero, who starts on the task straight away, without research or a plan.',
};

/**
 * The council's welcome (§1.1, §7.1 screen 9, #180), once the New Quest form (spec §14.1, §4.1), and the
 * first-run API-key card (§11.6). Plain DOM in a native <dialog>, so it is keyboard-accessible.
 * Credentials go over the host channel, never the protocol. It opens in the council hut once the elder
 * has walked in (#244), from the hut, "Ibitsa: New Quest" or the command bar.
 *
 * The elder asks what you want to do on Ibitsa (the task): **Ask the elder to research it first**
 * (#101), or **Start a quick quest now**, which shows the hero's fields straight away. A line under
 * the buttons says what each one does and costs (#270). After the elder's
 * brief it opens again with the hero's fields for the quick quest.
 *
 * The welcome docks low in the hut as the elder's dialogue box, with its portrait, so the elder stays
 * in view at the table above it (#254). The API-key card is a plain card in the middle.
 */
export function mountNewQuestForm({
  client,
  host,
  partyCheck,
  portrait,
  onCancel,
}: {
  client: GameClient;
  host: Host;
  /** The quick quest's hero sets out once its class's ACP agent passes the party check (#199). */
  partyCheck: PartyCheck;
  /** A portrait's URL for a pack character, e.g. `councillor.elder`; null without one. */
  portrait?: (appearance: string) => string | null;
  /** Cancel or Escape: with no campaign, the welcome is over and the hut closes (#244). */
  onCancel?: () => void;
}): NewQuestForm {
  const dialog = el('dialog', { className: 'new-quest council-welcome' });
  dialog.setAttribute('aria-label', 'Welcome');
  document.body.appendChild(dialog);

  let snapshot: Snapshot | null = null;
  let pendingStart: (() => void) | null = null;
  let renderOnboarding: ((error?: string) => void) | null = null;

  let mode: 'ask' | 'quest' = 'ask';
  /** The onboarding card was opened for someone else (party assembly, #123): Back closes it. */
  let forOthers = false;
  const active = () => snapshot?.campaign?.status === 'active';
  const planning = () => snapshot?.campaign?.status === 'planning';
  client.onSnapshot((s) => {
    snapshot = s;
    if (active() && dialog.open) dialog.close();
    if (dialog.open && !renderOnboarding) refreshBranches();
  });

  dialog.addEventListener('cancel', () => onCancel?.());

  host.onHostEvent((event: HostEvent) => {
    switch (event.type) {
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
  description.rows = 2;
  description.required = true;
  description.placeholder = 'The task. Its first line becomes the quest title.';
  const classSelect = el('select');
  // The classes in play can change in the Armory (#182): the list is filled again on each opening.
  const fillClasses = () => {
    const chosen = classSelect.value || DEFAULT_CLASS;
    classSelect.replaceChildren(
      ...heroClasses().map((c) => new Option(`${c.label} (${c.model})`, c.id)),
    );
    classSelect.value = heroClasses().some((c) => c.id === chosen) ? chosen : DEFAULT_CLASS;
  };
  fillClasses();
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
    partyCheck.check([classSelect.value]);
    // A Claude class needs no check, so no answer will redraw the line.
    refreshBranches();
  };
  const checkLine = el('div', { className: 'party-check' });
  partyCheck.onChange(() => refreshBranches());

  const field = (label: string, control: HTMLElement) => {
    const wrapper = el('label');
    wrapper.append(el('span', { text: label }), control);
    return wrapper;
  };
  const start = el('button', { text: ASK_LABEL });
  start.type = 'submit';
  const skip = button({ label: QUICK_LABEL, onClick: () => setMode('quest') });
  const heroFields = el('div', { className: 'hero-fields' });
  heroFields.append(
    field('Hero class', classSelect),
    checkLine,
    field('Hero name', heroName),
    nameSuggestions,
    field('Start from branch', baseSelect),
    repoNote,
  );
  // What each way to start does and costs (#270), each line describing its button.
  const askNote = el('ul', { className: 'note choices' });
  for (const [b, choice] of [
    [start, ASK_CHOICE],
    [skip, QUICK_CHOICE],
  ] as const) {
    const line = el('li');
    line.id = `welcome-${b === start ? 'ask' : 'quick'}`;
    line.append(el('strong', { text: choice.label }), ` ${choice.text}`);
    b.setAttribute('aria-describedby', line.id);
    askNote.append(line);
  }
  // The elder speaks (§1.1): the welcome, then the question the task answers. Its portrait is set on
  // each opening, since the pack's portraits load after the form is mounted.
  const face = el('img', { className: 'portrait' });
  face.alt = '';
  const words = el('div');
  words.append(
    el('p', { className: 'speaker', text: 'Elder' }),
    el('p', { text: 'We heard you are looking for Ibitsa… …what do you want to do there?' }),
  );
  const speech = el('header', { className: 'elder-speech' });
  speech.append(face, words);
  const showFace = () => {
    const src = portrait?.(councillorAppearance(ELDER)) ?? null;
    face.hidden = !src;
    if (!src) return;
    face.src = src;
    face.style.filter = recolorFilter(recolorOf(`councillor:${ELDER}`));
  };
  form.append(
    speech,
    field('Task', description),
    askNote,
    heroFields,
    error,
    el('div', { className: 'actions' }),
  );
  form.lastElementChild?.append(
    start,
    skip,
    button({
      label: 'Cancel',
      onClick: () => {
        dialog.close();
        onCancel?.();
      },
    }),
  );

  function setMode(next: 'ask' | 'quest'): void {
    mode = next;
    const quest = mode !== 'ask';
    heroFields.hidden = !quest;
    askNote.hidden = quest;
    skip.hidden = quest;
    // The task is written by now: one row leaves room for the hero's fields under the elder (#254).
    description.rows = quest ? 1 : 2;
    start.textContent = quest ? 'Start quest' : ASK_LABEL;
    if (quest) start.removeAttribute('aria-describedby');
    else start.setAttribute('aria-describedby', 'welcome-ask');
    heroName.required = quest;
    if (quest) partyCheck.check([classSelect.value]);
    refreshBranches();
    if (quest) classSelect.focus();
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    error.textContent = '';
    if (active()) {
      error.textContent = 'Finish or abandon the current quest first.';
      return;
    }
    const task = description.value.trim();
    if (!task) return;
    const hero = {
      heroName: heroName.value.trim(),
      classId: classSelect.value,
      baseRef: baseSelect.value,
    };
    const intent =
      mode === 'ask'
        ? { type: 'consultElder' as const, task }
        : { type: 'startQuest' as const, description: task, ...hero };
    if (intent.type !== 'consultElder' && (!hero.heroName || !hero.baseRef)) return;
    if (intent.type !== 'consultElder' && !partyCheck.allReady([hero.classId])) {
      error.textContent = AGENTS_NOT_READY;
      return;
    }
    // Ask the extension first: without credentials the onboarding card comes before the quest.
    pendingStart = () => {
      client.send(intent);
      dialog.close();
    };
    host.request({ channel: 'host', type: 'credentialsStatus' });
  };

  function fillSuggestions(): void {
    const names = heroClasses().find((c) => c.id === classSelect.value)?.names ?? [];
    const label = heroClasses().find((c) => c.id === classSelect.value)?.label ?? '';
    nameSuggestions.replaceChildren(...names.map((n) => new Option(`${label} ${n}`)));
  }

  function refreshBranches(): void {
    const repo = snapshot?.repo;
    const current = baseSelect.value;
    baseSelect.replaceChildren(...(repo?.branches ?? []).map((b) => new Option(b, b)));
    baseSelect.value = repo?.branches.includes(current) ? current : (repo?.defaultBranch ?? '');
    // Only the quest needs git, and its hero's agent to pass the party check (#199): the elder just
    // reads the folder.
    const quest = mode !== 'ask';
    checkLine.replaceChildren(
      ...(quest ? [readinessLine({ partyCheck, classId: classSelect.value })] : []),
    );
    start.disabled = quest && (repo === null || !partyCheck.allReady([classSelect.value]));
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
          if (forOthers) dialog.close();
          else {
            dialog.replaceChildren(form);
            dialog.classList.add('docked');
          }
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
    dialog.classList.remove('docked');
    if (!dialog.open) dialog.showModal();
    key.focus();
  }

  return {
    open,
    quickQuest: (task) => show({ mode: 'quest', task }),
    withCredentials: (then) => {
      // Without credentials the onboarding card comes first, in this form's dialog (§11.6).
      forOthers = true;
      renderOnboarding = null;
      pendingStart = () => {
        then();
        if (dialog.open) dialog.close();
      };
      host.request({ channel: 'host', type: 'credentialsStatus' });
    },
  };

  /** Opens it on the task alone; not while the elder's campaign plans (its panel offers the quest). */
  function open(prefill?: { description: string }): void {
    if (planning()) return;
    show({ mode: 'ask', ...(prefill ? { task: prefill.description } : {}) });
  }

  /** Opens the form, with the task already written when it comes from the command bar (#81) or the elder. */
  function show({ mode: next, task }: { mode: 'ask' | 'quest'; task?: string }): void {
    if (active() || dialog.open) return;
    forOthers = false;
    renderOnboarding = null;
    pendingStart = null;
    error.textContent = '';
    dialog.replaceChildren(form);
    dialog.classList.add('docked');
    showFace();
    fillClasses();
    fillSuggestions();
    dialog.showModal();
    if (task !== undefined) description.value = task;
    setMode(next);
    if (next === 'ask') description.focus();
  }
}
