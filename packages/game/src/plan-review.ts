import { type Plan, type Snapshot, taskOrder } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';

/**
 * The plan review in the hut (spec §4.5–4.6, §7.1 screen 3; #103, #104): the proposed plan's goal, its
 * tasks in the order the hero works them (files, dependencies, criteria per councillor) and the Book of
 * Decisions, with Approve, Ask for changes and Dismiss.
 */
export function mountPlanReview({ client }: { client: GameClient }): void {
  const box = el('section', { className: 'plan-review' });
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
      ...planDetails(plan.plan),
      changes,
      actions,
    );
  });
}

/** The plan's goal, tasks and decisions as page content. */
export function planDetails(plan: Plan): HTMLElement[] {
  const tasks = el('ol', { className: 'tasks' });
  tasks.setAttribute('aria-label', 'Tasks');
  for (const t of taskOrder(plan.tasks) ?? plan.tasks) {
    const li = el('li');
    li.append(
      el('strong', { text: `${t.id} ${t.title}` }),
      el('span', { text: ` ${t.description}` }),
    );
    const notes: string[] = [];
    if (t.dependsOn.length > 0) notes.push(`after ${t.dependsOn.join(', ')}`);
    if (t.files.length > 0) notes.push(t.files.join(', '));
    if (t.decisions.length > 0) notes.push(`keeps to ${t.decisions.join(', ')}`);
    if (notes.length > 0) li.append(el('div', { className: 'note', text: notes.join(' · ') }));
    for (const c of t.criteria) {
      li.append(
        el('div', { className: 'criteria', text: `${c.councillorId}: ${c.items.join('; ')}` }),
      );
    }
    tasks.append(li);
  }
  const parts: HTMLElement[] = [el('p', { className: 'goal', text: `Goal: ${plan.goal}` })];
  if (plan.scope) parts.push(el('p', { className: 'scope', text: `Scope: ${plan.scope}` }));
  parts.push(el('h3', { text: 'Tasks' }), tasks);
  if (plan.decisions.length > 0) {
    const book = el('ul', { className: 'decisions' });
    book.setAttribute('aria-label', 'Book of Decisions');
    for (const d of plan.decisions) {
      const li = el('li');
      li.append(
        el('strong', { text: `${d.id} ${d.title}` }),
        el('span', { text: ` ${d.chosen}. ${d.why}` }),
      );
      if (d.alternatives.length > 0) {
        li.append(
          el('div', {
            className: 'note',
            text: `Not chosen: ${d.alternatives.map((a) => `${a.option} (${a.rejectedBecause})`).join('; ')}`,
          }),
        );
      }
      book.append(li);
    }
    parts.push(el('h3', { text: 'Book of Decisions' }), book);
  }
  return parts;
}
