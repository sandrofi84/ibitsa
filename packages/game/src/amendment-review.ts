import type { AmendmentChange, AmendmentView, Snapshot } from '@ibitsa/protocol';
import type { AmendmentReview, ChangeLine } from './amendment-review.types';
import type { GameClient } from './client';
import { button, el } from './dom';

/** The amendment waiting for the user, if any (§4.8, #170). */
export function pendingAmendment(snapshot: Snapshot | null): AmendmentView | null {
  return snapshot?.sitting?.amendments?.find((a) => a.outcome.kind === 'proposed') ?? null;
}

/** The change set in words, each line marked by what it does: added, changed or removed. */
export function changeLines(changes: readonly AmendmentChange[]): ChangeLine[] {
  return changes.map(lineOf);
}

function lineOf(c: AmendmentChange): ChangeLine {
  switch (c.kind) {
    case 'added':
      return { kind: 'added', mark: '+', text: `Add ${c.taskId} ${c.title} (${c.island})` };
    case 'edited':
      return {
        kind: 'edited',
        mark: '~',
        text:
          c.before === c.title
            ? `Change ${c.taskId} ${c.title} (${c.island})`
            : `Change ${c.taskId} ${c.before} → ${c.title} (${c.island})`,
      };
    case 'removed':
      return { kind: 'removed', mark: '−', text: `Remove ${c.taskId} ${c.title} (${c.island})` };
    case 'island':
      return {
        kind: 'added',
        mark: '+',
        text: `New island ${c.islandId} ${c.title}: ${c.tasks.join(', ')}`,
      };
    case 'decision':
      return { kind: 'added', mark: '+', text: `Decision ${c.decisionId} ${c.title}` };
  }
}

/**
 * The council's amendment for the user to review (spec §4.8, #170): its summary and change set, with
 * Approve, Request changes (with a note) and Discard. Shown while one is waiting.
 */
export function mountAmendmentReview({ client }: { client: GameClient }): AmendmentReview {
  const box = el('section', { className: 'amendment-review' });
  box.setAttribute('aria-label', "The council's amendment");
  box.hidden = true;
  box.tabIndex = -1;
  document.body.appendChild(box);
  let shown = '';

  client.onSnapshot((snapshot) => {
    const pending = pendingAmendment(snapshot);
    box.hidden = !pending;
    if (!pending) {
      shown = '';
      return;
    }
    const key = `${snapshot.sitting?.id}:${pending.number}`;
    if (key === shown) return;
    shown = key;
    const list = el('ul', { className: 'changes' });
    for (const line of changeLines(pending.changes)) {
      const item = el('li', { className: line.kind });
      item.append(el('span', { className: 'mark', text: line.mark }), ` ${line.text}`);
      list.append(item);
    }
    const note = el('textarea');
    note.rows = 2;
    note.setAttribute('aria-label', 'What should change?');
    note.placeholder = 'What should change?';
    const number = pending.number;
    const actions = el('div', { className: 'actions' });
    actions.append(
      button({
        label: 'Approve',
        onClick: () => client.send({ type: 'approveAmendment', number }),
      }),
      button({
        label: 'Request changes',
        onClick: () => {
          const text = note.value.trim();
          if (!text) {
            note.focus();
            return;
          }
          client.send({ type: 'requestAmendmentChange', number, text });
        },
      }),
      button({
        label: 'Discard',
        onClick: () => client.send({ type: 'discardAmendment', number }),
      }),
    );
    box.replaceChildren(
      el('h2', { text: `The council proposes Amendment ${number}` }),
      el('p', { className: 'summary', text: pending.amendment.summary }),
      list,
      el('p', {
        className: 'note',
        text: 'Only work that hasn’t started changes; heroes hear about it after their current step.',
      }),
      note,
      actions,
    );
  });

  return {
    focus: () => {
      if (!box.hidden) box.focus();
    },
  };
}
