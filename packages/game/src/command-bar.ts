import type { Snapshot } from '@ibitsa/protocol';
import { attachActionPreview } from './action-preview';
import { atMenu, handles } from './at-menu';
import type { CommandBar, CommandBarOptions } from './command-bar.types';
import { createCommandInput } from './command-input';
import { el } from './dom';
import { ALL, heroHandle, parseMessage } from './mentions';
import { slashMenu } from './slash-menu';

/**
 * The command bar (spec §6.1, #81): one input along the bottom of the game, focused with / or ⌘K.
 * While a quest runs it messages the hero; with none, Enter offers to start one with what you typed.
 * The first @mention naming a recipient (#83) chooses who gets the message and is taken out of it;
 * file @mentions stay in the text as paths. Without one, the message goes to the only hero.
 */
export function mountCommandBar({
  client,
  history,
  onHistoryChange,
  startQuest,
  newAction,
}: CommandBarOptions): CommandBar {
  const bar = el('section', { className: 'command-bar' });
  bar.setAttribute('aria-label', 'Command bar');
  let snapshot: Snapshot | null = null;
  const heroes = () => (snapshot?.campaign?.status === 'active' ? snapshot.heroes : []);
  const hero = () => heroes()[0] ?? null;

  const input = createCommandInput({
    label: 'Command bar',
    placeholder: 'Message the hero… (/ or ⌘K)',
    history,
    onHistoryChange,
    menus: [
      atMenu({ client, recipients: true }),
      slashMenu({ client, ...(newAction ? { newAction } : {}) }),
    ],
    onSend: ({ text, priority }) => {
      const all = heroes();
      if (all.length === 0) {
        startQuest(text);
        return;
      }
      const parsed = parseMessage({ text, recipients: handles(all) });
      if (!parsed.text) return;
      const targets =
        parsed.recipient === ALL
          ? all
          : all.filter((h) =>
              parsed.recipient ? heroHandle(h.name) === parsed.recipient : h === all[0],
            );
      for (const target of targets) {
        client.send({ type: 'sendMessage', heroId: target.id, text: parsed.text, priority });
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
  });
  document.body.appendChild(bar);

  client.onSnapshot((s) => {
    snapshot = s;
    const target = hero();
    input.input.placeholder = target
      ? `Message ${target.name}, @ for files… (/ or ⌘K)`
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
