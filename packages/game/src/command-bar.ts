import type { Snapshot } from '@ibitsa/protocol';
import { attachActionPreview } from './action-preview';
import { atMenu, handles } from './at-menu';
import type { CommandIntent } from './client.types';
import type { CommandBar, CommandBarOptions } from './command-bar.types';
import { createCommandInput } from './command-input';
import { el } from './dom';
import { councilMessage, messageTargets, sittingHandles, sittingMessage } from './mentions';
import { slashMenu } from './slash-menu';

/**
 * The command bar (spec §6.1, #81): one input along the bottom of the game, focused with / or ⌘K.
 * While a quest runs it messages the hero; with none, Enter offers to start one with what you typed.
 * The first @mention naming a recipient (#83) chooses who gets the message and is taken out of it;
 * file @mentions stay in the text as paths; `@all` reaches every hero with a session. Without one, the
 * message goes to the selected hero (#125).
 */
export function mountCommandBar({
  client,
  history,
  onHistoryChange,
  startQuest,
  newAction,
  selection,
}: CommandBarOptions): CommandBar {
  const bar = el('section', { className: 'command-bar' });
  bar.setAttribute('aria-label', 'Command bar');
  let snapshot: Snapshot | null = null;
  const heroes = () => (snapshot?.campaign?.status === 'active' ? snapshot.heroes : []);
  const hero = () =>
    heroes().length === 0 ? null : (selection?.selected(snapshot) ?? heroes()[0] ?? null);
  const selected = () => hero()?.id ?? null;

  const input = createCommandInput({
    label: 'Command bar',
    placeholder: 'Message the hero… (/ or ⌘K)',
    history,
    onHistoryChange,
    menus: [
      atMenu({ client, recipients: true, selected }),
      slashMenu({ client, selected, ...(newAction ? { newAction } : {}) }),
    ],
    onSend: ({ text, priority }) => {
      // While the council sits, the bar talks to it (#242): all of it, or the councillor an @ names.
      if (sittingHandles(snapshot).length > 0) {
        const told = sittingMessage({ text, snapshot });
        if (told) client.send(consult(told));
        return;
      }
      const all = heroes();
      if (all.length === 0) {
        startQuest(text);
        return;
      }
      // `@council` or `@<councillor>` asks the council (#169); heroes keep working.
      const council = councilMessage({ text, snapshot });
      if (council) {
        client.send(consult(council));
        return;
      }
      const message = messageTargets({ text, heroes: all, selected: selected() });
      if (!message.text) return;
      for (const target of message.targets) {
        client.send({ type: 'sendMessage', heroId: target.id, text: message.text, priority });
      }
    },
  });
  bar.append(input.element);
  // Needs you sits just above the bar, however tall it grows (a preview, several lines).
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--command-bar-height', `${bar.offsetHeight}px`);
  }).observe(bar);
  attachActionPreview({
    client,
    input,
    recipients: () => handles(client.snapshot?.heroes ?? []),
    selected,
  });
  document.body.appendChild(bar);

  const refresh = () => {
    if (sittingHandles(snapshot).length > 0) {
      input.input.placeholder = 'Tell the council, @ to name a councillor… (/ or ⌘K)';
      input.setButtons({ next: 'Send', now: null });
      input.setHint(null);
      return;
    }
    const target = hero();
    input.input.placeholder = target
      ? `Message ${target.name}, @ for files… (/ or ⌘K)`
      : 'Describe a task to start a quest… (/ or ⌘K)';
    input.setButtons(
      target ? { next: 'Send', now: 'Send now' } : { next: 'Start a quest', now: null },
    );
    input.setHint(target ? null : 'Enter starts a quest with this as its task.');
  };
  client.onSnapshot((s) => {
    snapshot = s;
    refresh();
  });
  // Choosing another hero changes whom the bar speaks to (#125).
  selection?.onSelect(refresh);

  // / and ⌘K reach the bar from anywhere that isn't already a text field.
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const shortcut = (e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing);
    if (!shortcut || (typing && e.key === '/')) return;
    e.preventDefault();
    input.input.focus();
  });

  return {
    element: bar,
    focus: () => input.input.focus(),
    fill: (text) => {
      input.input.value = text;
      input.input.dispatchEvent(new Event('input'));
      input.input.focus();
    },
  };
}

/** The command that tells the council, or one councillor, what the user wrote. */
function consult({
  councillorId,
  text,
}: {
  councillorId: string | null;
  text: string;
}): CommandIntent {
  return { type: 'consultCouncil', text, ...(councillorId ? { councillorId } : {}) };
}
