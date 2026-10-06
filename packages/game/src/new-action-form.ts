import type { ActionDraft } from '@ibitsa/protocol';
import { draftProblems, renamed } from './action-draft';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { NewActionForm } from './new-action-form.types';

/**
 * "New action" (spec §6.2, #86): saves a prompt you use often as a Claude Code skill, offered at the
 * end of the / menu. A native <dialog>, like the New Quest form, so it works from the keyboard. A name
 * that's taken offers Rename or Overwrite.
 */
export function mountNewActionForm({ client }: { client: GameClient }): NewActionForm {
  const dialog = el('dialog', { className: 'new-quest new-action' });
  dialog.setAttribute('aria-label', 'New action');
  document.body.appendChild(dialog);

  const form = el('form');
  const name = el('input');
  name.placeholder = 'pr-summary';
  name.autocomplete = 'off';
  const description = el('input');
  description.placeholder = 'Summarize the pull request for a reviewer';
  const argumentHint = el('input');
  argumentHint.placeholder = '[focus]';
  const prompt = el('textarea');
  prompt.rows = 4;
  prompt.placeholder =
    'What the hero should do. $ARGUMENTS stands for what you type after the name.';
  const target = choice({
    legend: 'For',
    name: 'action-target',
    options: [
      { value: 'hero', label: 'Heroes' },
      { value: 'any', label: 'Anyone' },
    ],
  });
  const scope = choice({
    legend: 'Save in',
    name: 'action-scope',
    options: [
      { value: 'personal', label: 'Personal: your ~/.claude/skills, in every project' },
      {
        value: 'project',
        label:
          "Project: this repository's .claude/skills, to commit and share. Heroes already on a quest see it once it's in their branch.",
      },
    ],
  });
  const message = el('p', { className: 'error' });
  message.setAttribute('role', 'alert');
  const clash = el('div', { className: 'actions' });
  clash.hidden = true;
  const save = el('button', { text: 'Save action' });
  save.type = 'submit';
  const actions = el('div', { className: 'actions' });
  actions.append(save, button({ label: 'Cancel', onClick: () => dialog.close() }));
  form.append(
    el('h2', { text: 'New action' }),
    field({ label: 'Name', control: name }),
    field({ label: 'Description', control: description }),
    field({ label: 'Argument hint (optional)', control: argumentHint }),
    field({ label: 'Prompt', control: prompt }),
    target.element,
    scope.element,
    message,
    clash,
    actions,
  );
  dialog.append(form);

  const draft = (): ActionDraft => ({
    name: name.value.trim(),
    description: description.value.trim(),
    argumentHint: argumentHint.value.trim(),
    prompt: prompt.value,
    target: target.value() as ActionDraft['target'],
    scope: scope.value() as ActionDraft['scope'],
  });

  function send(overwrite: boolean): void {
    const problems = draftProblems(draft());
    clash.hidden = true;
    message.textContent = problems.join(' ');
    if (problems.length > 0) return;
    save.disabled = true;
    client.createAction({ draft: draft(), overwrite });
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    send(false);
  };

  client.onActionResult((result) => {
    if (!dialog.open || result.name !== name.value.trim()) return;
    save.disabled = false;
    if (result.ok) {
      dialog.close();
      return;
    }
    message.textContent = result.reason;
    if (!result.clash) return;
    const taken = client.actions.flatMap((a) => [a.name, ...a.aliases]);
    const other = renamed({ name: result.name, taken: [...taken, result.name] });
    clash.replaceChildren(
      button({
        label: `Rename to ${other}`,
        onClick: () => {
          name.value = other;
          send(false);
        },
      }),
      button({ label: 'Overwrite', onClick: () => send(true) }),
    );
    clash.hidden = false;
  });

  return {
    open: () => {
      if (dialog.open) return;
      form.reset();
      message.textContent = '';
      clash.hidden = true;
      save.disabled = false;
      dialog.showModal();
      name.focus();
    },
  };
}

function field({ label, control }: { label: string; control: HTMLElement }): HTMLLabelElement {
  const wrapper = el('label');
  wrapper.append(el('span', { text: label }), control);
  return wrapper;
}

/** A group of radio buttons; the first option is chosen by default. */
function choice({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
}): { element: HTMLFieldSetElement; value: () => string } {
  const element = el('fieldset', { className: 'choice' });
  element.append(el('legend', { text: legend }));
  for (const [i, option] of options.entries()) {
    const label = el('label', { className: 'radio' });
    const input = el('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.defaultChecked = i === 0;
    label.append(input, el('span', { text: option.label }));
    element.append(label);
  }
  return {
    element,
    value: () =>
      element.querySelector<HTMLInputElement>('input:checked')?.value ?? options[0]?.value ?? '',
  };
}
