import type { CommandHistory } from './command-history';

export interface CommandInputOptions {
  /** The input's accessible name, e.g. "Message to the hero". */
  label: string;
  placeholder: string;
  /** Called with the text and how urgently: Enter is `next` (after the current step), ⌥Enter `now`. */
  onSend: (message: { text: string; priority: 'now' | 'next' }) => void;
  /** Shared ↑/↓ history; called back after each send so it can be saved. */
  history: CommandHistory;
  onHistoryChange: () => void;
  /** The send buttons' labels; the default is Send and Send now. */
  buttons?: { next: string; now: string | null };
}

export interface CommandInput {
  readonly element: HTMLElement;
  readonly input: HTMLTextAreaElement;
  /** Shows a short hint under the input (e.g. what Enter will do), or hides it with null. */
  setHint(text: string | null): void;
  /** Changes the send buttons' labels; `now` null hides the second button. */
  setButtons(labels: { next: string; now: string | null }): void;
}
