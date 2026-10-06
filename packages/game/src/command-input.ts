import type { CommandInput, CommandInputOptions } from './command-input.types';
import { activeToken, applyChoice } from './command-menu';
import type { MenuItem, MenuToken } from './command-menu.types';
import { button, el } from './dom';

let ids = 0;

/**
 * The command bar's input (#81), shared by the bar at the bottom and the hero pane, with the keys from
 * §6.1: Enter sends after the current step, ⌥Enter sends now, ⇧Enter adds a line, ↑/↓ recall earlier
 * messages, Esc clears and then leaves the input.
 *
 * Menus (#83): while a token starting with a provider's trigger is typed, the combobox opens a listbox
 * of its suggestions. ↑/↓ move through them, Enter or Tab chooses, a click chooses, Esc closes the menu
 * before doing anything else.
 */
export function createCommandInput({
  label,
  placeholder,
  onSend,
  history,
  onHistoryChange,
  buttons = { next: 'Send', now: 'Send now' },
  menus = [],
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
  menu.setAttribute('aria-label', 'Suggestions');
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

  // ---------- the menu ----------

  let items: MenuItem[] = [];
  let active = 0;
  let token: MenuToken | null = null;
  let asked = 0;
  const triggers = menus.map((m) => m.trigger);
  const open = () => items.length > 0;

  function refresh(): void {
    const found = activeToken({ text: input.value, caret: input.selectionStart, triggers });
    const provider = found && menus.find((m) => m.trigger === found.trigger);
    if (!found || !provider) {
      close();
      return;
    }
    const mine = ++asked;
    void Promise.resolve(
      provider.suggest({
        text: input.value,
        token: found.token,
        query: found.query,
        before: input.value.slice(0, found.start),
      }),
    ).then((suggested) => {
      // A newer keystroke has asked since: its answer wins.
      if (mine !== asked) return;
      token = found;
      show(suggested);
    });
  }

  function show(suggested: MenuItem[]): void {
    items = suggested;
    active = 0;
    if (!open()) {
      close();
      return;
    }
    let group: string | undefined;
    const rows: HTMLLIElement[] = [];
    items.forEach((item, i) => {
      if (item.group && item.group !== group) {
        group = item.group;
        const heading = el('li', { className: 'command-menu-group', text: item.group });
        heading.setAttribute('role', 'presentation');
        rows.push(heading);
      }
      const option = el('li', { className: 'command-menu-option' });
      option.id = `${id}-option-${i}`;
      option.setAttribute('role', 'option');
      option.append(el('span', { className: 'label', text: item.label }));
      if (item.detail) option.append(el('span', { className: 'detail', text: item.detail }));
      // mousedown, not click: the input keeps focus, so the caret is still where the token is.
      option.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(i);
      });
      rows.push(option);
    });
    menu.replaceChildren(...rows);
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight();
  }

  function highlight(): void {
    items.forEach((_, i) => {
      menu.querySelector(`#${id}-option-${i}`)?.setAttribute('aria-selected', String(i === active));
    });
    input.setAttribute('aria-activedescendant', `${id}-option-${active}`);
    menu.querySelector(`#${id}-option-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  function choose(i: number): void {
    const item = items[i];
    if (!item || !token) return;
    const next = applyChoice({
      text: input.value,
      caret: input.selectionStart,
      token,
      insert: item.insert,
    });
    input.value = next.text;
    input.setSelectionRange(next.caret, next.caret);
    close();
    fit();
  }

  function close(): void {
    asked += 1;
    items = [];
    token = null;
    menu.hidden = true;
    menu.replaceChildren();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  // ---------- sending ----------

  function send(priority: 'now' | 'next'): void {
    const text = input.value.trim();
    if (!text) return;
    onSend({ text, priority });
    history.add(text);
    onHistoryChange();
    input.value = '';
    close();
    fit();
  }

  /** Grows with its lines, up to six. */
  function fit(): void {
    input.rows = Math.min(6, Math.max(1, input.value.split('\n').length));
  }

  input.addEventListener('input', () => {
    fit();
    refresh();
  });
  input.addEventListener('blur', close);
  input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refresh();
  });
  input.addEventListener('keydown', (e) => {
    if (open()) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        highlight();
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey && !e.altKey) || e.key === 'Tab') {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
    }
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
