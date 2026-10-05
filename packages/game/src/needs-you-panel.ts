import type { NeedsYouItem, Snapshot } from '@ibitsa/protocol';
import type { CommandIntent, GameClient } from './client';

/**
 * The "Needs you" queue (spec §6.4) as plain DOM below the map: keyboard-accessible, readable text,
 * and every permission shown exactly as the core rendered it.
 */
export function mountNeedsYouPanel(client: GameClient): void {
  const panel = document.createElement('section');
  panel.className = 'needs-you';
  panel.setAttribute('aria-label', 'Needs you');
  document.body.appendChild(panel);
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  document.body.appendChild(toast);

  let shown = '';
  client.onSnapshot((snapshot) => {
    const key = JSON.stringify(snapshot.needsYou);
    if (key === shown) return;
    shown = key;
    panel.replaceChildren(
      ...snapshot.needsYou.map((item) => renderItem({ item, snapshot, client })),
    );
    panel.hidden = snapshot.needsYou.length === 0;
  });
  panel.hidden = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  client.onCue((cue) => {
    if (cue.type !== 'commandRejected') return;
    toast.textContent = cue.reason;
    toast.classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => toast.classList.remove('visible'), 4_000);
  });
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  { text, className }: { text?: string; className?: string } = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}

function button({
  label,
  intent,
  client,
}: {
  label: string;
  intent: () => CommandIntent;
  client: GameClient;
}): HTMLButtonElement {
  const b = el('button', { text: label });
  b.onclick = () => client.send(intent());
  return b;
}

function renderItem({
  item,
  snapshot,
  client,
}: {
  item: NeedsYouItem;
  snapshot: Snapshot;
  client: GameClient;
}): HTMLElement {
  const hero = snapshot.heroes.find((h) => h.id === item.heroId)?.name ?? 'A hero';
  const box = el('article', { className: `item ${item.kind}` });
  const actions = el('div', { className: 'actions' });
  switch (item.kind) {
    case 'permission': {
      const p = el('p');
      p.append(
        el('strong', { text: hero }),
        ` wants to ${item.action.toLowerCase()}: `,
        el('code', { text: item.target }),
      );
      box.append(p, el('p', { text: `in ${item.cwd}`, className: 'muted' }));
      actions.append(
        button({
          label: 'Allow',
          intent: () => ({ type: 'answerPermission', itemId: item.id, decision: 'allow' }),
          client,
        }),
        button({
          label: 'Deny',
          intent: () => ({ type: 'answerPermission', itemId: item.id, decision: 'deny' }),
          client,
        }),
      );
      break;
    }
    case 'question': {
      const q = item.questions[0];
      box.append(el('p', { text: `${hero} asks: ${q?.question ?? ''}` }));
      for (const option of q?.options ?? []) {
        actions.append(
          button({
            label: option.label,
            intent: () => ({
              type: 'answerQuestion',
              itemId: item.id,
              answers: { [q?.question ?? '']: option.label },
            }),
            client,
          }),
        );
      }
      break;
    }
    case 'reply': {
      box.append(
        el('p', { text: `${hero} is waiting for orders.` }),
        el('blockquote', { text: item.text || '(no message)' }),
      );
      const input = el('textarea');
      input.rows = 2;
      input.setAttribute('aria-label', `Message to ${hero}`);
      actions.append(
        input,
        button({
          label: 'Send',
          intent: () => ({
            type: 'sendMessage',
            heroId: item.heroId,
            text: input.value.trim() || 'Continue.',
            priority: 'next',
          }),
          client,
        }),
        button({
          label: 'Mark done',
          intent: () => ({ type: 'markDone', heroId: item.heroId }),
          client,
        }),
      );
      break;
    }
    case 'stalled':
    case 'error':
      box.append(
        el('p', { text: `${hero}: ${item.kind === 'stalled' ? item.reason : item.message}` }),
      );
      actions.append(
        button({
          label: item.kind === 'stalled' ? 'Continue' : 'Retry',
          intent: () => ({ type: 'resumeHero', heroId: item.heroId }),
          client,
        }),
        button({
          label: 'Stop',
          intent: () => ({ type: 'stopHero', heroId: item.heroId }),
          client,
        }),
      );
      break;
    case 'outOfGold':
      box.append(el('p', { text: `${hero} is out of gold.` }));
      actions.append(
        button({
          label: 'Raise the cap by $1',
          intent: () => ({ type: 'raiseBudget', heroId: item.heroId, addMicroUsd: 1_000_000 }),
          client,
        }),
        button({
          label: 'Stop',
          intent: () => ({ type: 'stopHero', heroId: item.heroId }),
          client,
        }),
      );
      break;
  }
  box.append(actions);
  return box;
}
