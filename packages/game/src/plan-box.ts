import type { Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';

/**
 * The council's proposed plan in the hut (spec §4.6, #103): its summary with Approve, Ask for changes
 * and Dismiss. #104 grows this into the full plan review.
 */
export function mountPlanBox({ client }: { client: GameClient }): void {
  const box = el('section', { className: 'plan-box' });
  box.setAttribute('aria-label', "The council's plan");
  box.hidden = true;
  document.body.appendChild(box);
  let shown = '';

  client.onSnapshot((snapshot: Snapshot) => {
    const sitting = snapshot.sitting;
    const plan = sitting?.status === 'awaitingApproval' ? sitting.plans.at(-1) : undefined;
    box.hidden = !plan;
    if (!sitting || !plan) {
      shown = '';
      return;
    }
    const key = `${sitting.id}:${plan.version}`;
    if (key === shown) return;
    shown = key;
    const changes = el('textarea');
    changes.rows = 3;
    changes.setAttribute('aria-label', 'What should change?');
    changes.placeholder = 'What should change?';
    const ask = button({
      label: 'Ask for changes',
      onClick: () => {
        const text = changes.value.trim();
        if (!text) {
          changes.focus();
          return;
        }
        client.send({ type: 'requestPlanChange', version: plan.version, text });
      },
    });
    const actions = el('div', { className: 'actions' });
    actions.append(
      button({
        label: 'Approve',
        onClick: () => client.send({ type: 'approvePlan', version: plan.version }),
      }),
      ask,
      button({
        label: 'Dismiss the council',
        onClick: () => client.send({ type: 'dismissCouncil' }),
      }),
    );
    box.replaceChildren(
      el('h2', { text: `The council proposes (v${plan.version})` }),
      el('p', { className: 'summary', text: plan.plan.summary }),
      changes,
      actions,
    );
  });
}
