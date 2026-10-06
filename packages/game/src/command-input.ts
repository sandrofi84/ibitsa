import type { CommandInput, CommandInputOptions } from './command-input.types';
import { button, el } from './dom';

let ids = 0;

/**
 * The command bar's input (#81), shared by the bar at the bottom and the hero pane: a combobox ready
 * for the @ and / menus (#83, #84), with the keys from §6.1. Enter sends after the current step, ⌥Enter
 * sends now, ⇧Enter adds a line, ↑/↓ recall earlier messages, Esc clears and then leaves the input.
 */
export function createCommandInput({
  label,
  placeholder,
  onSend,
  history,
  onHistoryChange,
  buttons = { next: 'Send', now: 'Send now' },
}: CommandInputOptions): CommandInput {
  const id = `command-${++ids}`;
  const element = el('div', { className: 'command-input' });
  const input = el('textarea');
  input.rows = 1;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', `${id}-menu`);
  const menu = el('ul', { className: 'command-menu' });
  menu.id = `${id}-menu`;
  menu.setAttribute('role', 'listbox');
  menu.hidden = true;
  const hint = el('p', { className: 'command-hint' });
  hint.id = `${id}-hint`;
  hint.hidden = true;
  input.setAttribute('aria-describedby', hint.id);
  const sendNext = button({ label: buttons.next, onClick: () => send('next') });
  const sendNow = button({ label: buttons.now ?? '', onClick: () => send('now') });
  sendNow.hidden = buttons.now === null;
  const actions = el('div', { className: 'command-actions' });
  actions.append(sendNext, sendNow);
  element.append(menu, input, hint, actions);

  function send(priority: 'now' | 'next'): void {
    const text = input.value.trim();
    if (!text) return;
    onSend({ text, priority });
    history.add(text);
    onHistoryChange();
    input.value = '';
    fit();
  }

  /** Grows with its lines, up to six. */
  function fit(): void {
    input.rows = Math.min(6, Math.max(1, input.value.split('\n').length));
  }

  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    const before = input.value.slice(0, input.selectionStart);
    const after = input.value.slice(input.selectionEnd);
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(e.altKey ? 'now' : 'next');
    } else if (e.key === 'ArrowUp' && !before.includes('\n')) {
      const previous = history.previous(input.value);
      if (previous === null) return;
      e.preventDefault();
      input.value = previous;
      fit();
    } else if (e.key === 'ArrowDown' && !after.includes('\n')) {
      const next = history.next();
      if (next === null) return;
      e.preventDefault();
      input.value = next;
      fit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value) {
        input.value = '';
        fit();
      } else {
        input.blur();
      }
    }
  });

  return {
    element,
    input,
    setHint(text) {
      hint.hidden = text === null;
      hint.textContent = text ?? '';
    },
    setButtons(labels) {
      sendNext.textContent = labels.next;
      sendNow.textContent = labels.now ?? '';
      sendNow.hidden = labels.now === null;
    },
  };
}
