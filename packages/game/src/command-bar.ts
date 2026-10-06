import type { Snapshot } from '@ibitsa/protocol';
import type { CommandBar, CommandBarOptions } from './command-bar.types';
import { createCommandInput } from './command-input';
import { el } from './dom';

/**
 * The command bar (spec §6.1, #81): one input along the bottom of the game, focused with / or ⌘K.
 * While a quest runs it messages the hero; with none, Enter offers to start one with what you typed.
 */
export function mountCommandBar({
  client,
  history,
  onHistoryChange,
  startQuest,
}: CommandBarOptions): CommandBar {
  const bar = el('section', { className: 'command-bar' });
  bar.setAttribute('aria-label', 'Command bar');
  let snapshot: Snapshot | null = null;
  const hero = () =>
    snapshot?.campaign?.status === 'active' ? (snapshot.heroes[0] ?? null) : null;

  const input = createCommandInput({
    label: 'Command bar',
    placeholder: 'Message the hero… (/ or ⌘K)',
    history,
    onHistoryChange,
    onSend: ({ text, priority }) => {
      const target = hero();
      if (target) client.send({ type: 'sendMessage', heroId: target.id, text, priority });
      else startQuest(text);
    },
  });
  bar.append(input.element);
  document.body.appendChild(bar);

  client.onSnapshot((s) => {
    snapshot = s;
    const target = hero();
    input.input.placeholder = target
      ? `Message ${target.name}… (/ or ⌘K)`
      : 'Describe a task to start a quest… (/ or ⌘K)';
    input.setButtons(
      target ? { next: 'Send', now: 'Send now' } : { next: 'Start a quest', now: null },
    );
    input.setHint(target ? null : 'Enter starts a quest with this as its task.');
  });

  // / and ⌘K reach the bar from anywhere that isn't already a text field.
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const shortcut = (e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing);
    if (!shortcut || (typing && e.key === '/')) return;
    e.preventDefault();
    input.input.focus();
  });

  return { focus: () => input.input.focus() };
}
