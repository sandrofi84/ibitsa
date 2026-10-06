import type { ActionInfo } from '@ibitsa/protocol';
import type { ActionPreviewOptions } from './action-preview.types';
import { button, el } from './dom';

/** How long typing pauses before the preview is asked for. */
const DEBOUNCE_MS = 200;

/**
 * The action preview (spec §6.1, #85): while the message is `/action args` (after a recipient, if
 * named), a panel above the input shows the prompt Claude Code would get. Left alone, the message goes
 * as `/action args`, so Claude Code applies the skill's own settings; "Edit this message" puts the
 * expanded prompt in the input instead, to change and send as plain text.
 */
export function attachActionPreview({ client, input, recipients }: ActionPreviewOptions): void {
  const panel = el('section', { className: 'action-preview' });
  panel.setAttribute('aria-label', 'Action preview');
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  input.element.insertBefore(panel, input.input);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let asked = 0;

  const refresh = async () => {
    const parsed = parseAction({ text: input.input.value, recipients: recipients() });
    const ticket = ++asked;
    if (!parsed || client.snapshot?.campaign?.status !== 'active') {
      panel.hidden = true;
      return;
    }
    const action = findAction({ actions: await client.actionsReady(), name: parsed.name });
    if (!action || ticket !== asked) {
      if (!action) panel.hidden = true;
      return;
    }
    const preview = await client.preview({ name: action.name, args: parsed.args });
    if (ticket !== asked) return;
    const heading = el('h3', { text: `Preview of /${parsed.name}`, className: 'preview-title' });
    if (preview.text === null) {
      panel.replaceChildren(
        heading,
        el('p', {
          className: 'note',
          text: `No preview for this action: it's sent as /${parsed.name} ${parsed.args}`.trim(),
        }),
      );
    } else {
      const text = preview.text;
      const edit = button({
        label: 'Edit this message',
        onClick: () => {
          input.input.value = `${parsed.prefix}${text}`;
          input.input.dispatchEvent(new Event('input'));
          input.input.focus();
        },
      });
      panel.replaceChildren(
        heading,
        el('pre', { text }),
        ...preview.notes.map((n) => el('p', { className: 'note', text: n })),
        edit,
      );
    }
    panel.hidden = false;
  };

  input.input.addEventListener('input', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void refresh(), DEBOUNCE_MS);
  });
}

/** `[@recipient ]/name[ args]` → its parts; null for anything else. */
export function parseAction({
  text,
  recipients,
}: {
  text: string;
  recipients: readonly string[];
}): { prefix: string; name: string; args: string } | null {
  const match = text.match(/^(@(\S+)\s+)?\/([^\s/]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const [, prefix = '', handle, name = '', args = ''] = match;
  if (handle !== undefined && !recipients.includes(handle)) return null;
  return { prefix, name, args: args.trim() };
}

/** An action by its name or one of its aliases. */
export function findAction({
  actions,
  name,
}: {
  actions: readonly ActionInfo[];
  name: string;
}): ActionInfo | null {
  return actions.find((a) => a.name === name || a.aliases.includes(name)) ?? null;
}
