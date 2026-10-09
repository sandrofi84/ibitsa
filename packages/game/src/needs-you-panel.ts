import type { Finding, NeedsYouItem, Snapshot } from '@ibitsa/protocol';
import { pendingAmendment } from './amendment-review';
import type { GameClient } from './client';
import type { CommandIntent } from './client.types';
import { button, el } from './dom';
import type { NeedsYouPanelOptions } from './needs-you-panel.types';
import { councillorTitle, isSitting } from './sitting-hut';
import { findingText } from './task-review';

/**
 * The "Needs you" queue (spec §6.4) as plain DOM below the map: keyboard-accessible, readable text,
 * and every permission shown exactly as the core rendered it.
 */
export function mountNeedsYouPanel({
  client,
  openCouncil,
  replyToCouncil,
  selectHero,
  openTask,
  reviewAmendment,
  assembleParty,
}: NeedsYouPanelOptions): void {
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
    const council =
      councilItem({ snapshot, openCouncil }) ?? waitingItem({ snapshot, replyToCouncil });
    const amendment = amendmentItem({ snapshot, reviewAmendment });
    const parties = partyItems({ snapshot, assembleParty });
    const key = JSON.stringify([
      snapshot.needsYou,
      council?.dataset.batch ?? council?.dataset.waiting,
      amendment?.dataset.number,
      parties.map((p) => p.dataset.island),
    ]);
    if (key === shown) return;
    shown = key;
    panel.replaceChildren(
      ...(council ? [council] : []),
      ...(amendment ? [amendment] : []),
      ...parties,
      ...snapshot.needsYou.map((item) => {
        const box = renderItem({ item, snapshot, client, openTask });
        // Clicking an item (not one of its buttons) shows its hero in the pane (#125).
        box.addEventListener('click', (e) => {
          if (!(e.target as HTMLElement).closest('button')) selectHero?.(item.heroId);
        });
        return box;
      }),
    );
    panel.hidden = snapshot.needsYou.length === 0 && !council && !amendment && parties.length === 0;
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

/** The council's amendment waiting for the user (#170): one item that brings the review into view. */
function amendmentItem({
  snapshot,
  reviewAmendment,
}: {
  snapshot: Snapshot;
  reviewAmendment: (() => void) | undefined;
}): HTMLElement | null {
  const pending = pendingAmendment(snapshot);
  if (!pending) return null;
  const box = el('article', { className: 'item council' });
  box.dataset.number = String(pending.number);
  box.append(
    el('p', {
      text: `The council proposes Amendment ${pending.number}: ${pending.amendment.summary}`,
    }),
  );
  const actions = el('div', { className: 'actions' });
  actions.append(button({ label: 'Review', onClick: () => reviewAmendment?.() }));
  box.append(actions);
  return box;
}

/** Islands an amendment added that wait for their party (#170): one item each. */
function partyItems({
  snapshot,
  assembleParty,
}: {
  snapshot: Snapshot;
  assembleParty: ((islandId: string) => void) | undefined;
}): HTMLElement[] {
  return snapshot.islands
    .filter((i) => i.awaitingParty)
    .map((island) => {
      const box = el('article', { className: 'item party' });
      box.dataset.island = island.id;
      box.append(el('p', { text: `${island.name} needs its party.` }));
      const actions = el('div', { className: 'actions' });
      actions.append(button({ label: 'Assemble', onClick: () => assembleParty?.(island.id) }));
      box.append(actions);
      return box;
    });
}

/**
 * The council waiting on the user (#242): its turn ended with no question and no plan. One item that
 * takes the user to the command bar to answer it; what the council said shows in the hut.
 */
function waitingItem({
  snapshot,
  replyToCouncil,
}: {
  snapshot: Snapshot;
  replyToCouncil: (() => void) | undefined;
}): HTMLElement | null {
  const sitting = snapshot.sitting;
  if (!isSitting(sitting) || !sitting.waiting) return null;
  const box = el('article', { className: 'item council' });
  box.dataset.waiting = String(sitting.dialogue.length);
  box.append(el('p', { text: 'The council is waiting on you: tell it something, or dismiss it.' }));
  const actions = el('div', { className: 'actions' });
  actions.append(button({ label: 'Reply', onClick: () => replyToCouncil?.() }));
  box.append(actions);
  return box;
}

/** The council's waiting questions (§6.4, #102): one item that opens the dialogue box. */
function councilItem({
  snapshot,
  openCouncil,
}: {
  snapshot: Snapshot;
  openCouncil: () => void;
}): HTMLElement | null {
  const sitting = snapshot.sitting;
  const batch = isSitting(sitting) ? sitting.questions : null;
  if (!batch) return null;
  const box = el('article', { className: 'item council' });
  box.dataset.batch = batch.batchId;
  const askers = [...new Set(batch.items.map((q) => councillorTitle(q.councillorId)))];
  const count = batch.items.length;
  box.append(
    el('p', {
      text: `The council asks you ${count === 1 ? 'a question' : `${count} questions`} (${askers.join(', ')}).`,
    }),
  );
  const actions = el('div', { className: 'actions' });
  actions.append(button({ label: 'Answer', onClick: openCouncil }));
  box.append(actions);
  return box;
}

function intentButton({
  label,
  intent,
  client,
}: {
  label: string;
  intent: () => CommandIntent;
  client: GameClient;
}): HTMLButtonElement {
  return button({ label, onClick: () => client.send(intent()) });
}

function renderItem({
  item,
  snapshot,
  client,
  openTask,
}: {
  item: NeedsYouItem;
  snapshot: Snapshot;
  client: GameClient;
  openTask?: ((taskPointId: string) => void) | undefined;
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
        intentButton({
          label: 'Allow',
          intent: () => ({ type: 'answerPermission', itemId: item.id, decision: 'allow' }),
          client,
        }),
        intentButton({
          label: 'Deny',
          intent: () => ({ type: 'answerPermission', itemId: item.id, decision: 'deny' }),
          client,
        }),
      );
      // "Always allow" (#62): only when the agent offers rules, never for the hard limits.
      if (item.alwaysAllow.length > 0) {
        const rule = el('p', { className: 'muted' });
        rule.append('Always allow adds: ', el('code', { text: item.alwaysAllow.join(', ') }));
        box.append(rule);
        actions.append(
          intentButton({
            label: 'Always allow for this quest',
            intent: () => ({
              type: 'answerPermission',
              itemId: item.id,
              decision: 'allow',
              always: 'quest',
            }),
            client,
          }),
        );
        // An ACP agent's own rule (#200) means nothing to other heroes: this quest only.
        if (!item.questOnly) {
          actions.append(
            intentButton({
              label: 'Always allow in this project',
              intent: () => ({
                type: 'answerPermission',
                itemId: item.id,
                decision: 'allow',
                always: 'project',
              }),
              client,
            }),
          );
        }
      }
      break;
    }
    case 'question': {
      const q = item.questions[0];
      box.append(el('p', { text: `${hero} asks: ${q?.question ?? ''}` }));
      for (const option of q?.options ?? []) {
        actions.append(
          intentButton({
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
        intentButton({
          label: 'Send',
          intent: () => ({
            type: 'sendMessage',
            heroId: item.heroId,
            text: input.value.trim() || 'Continue.',
            priority: 'next',
          }),
          client,
        }),
        intentButton({
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
        intentButton({
          label: item.kind === 'stalled' ? 'Continue' : 'Resume',
          intent: () => ({ type: 'resumeHero', heroId: item.heroId }),
          client,
        }),
        intentButton({
          label: 'Stop',
          intent: () => ({ type: 'stopHero', heroId: item.heroId }),
          client,
        }),
      );
      break;
    case 'outOfGold':
      // The campaign's cap stops every hero; raising it lets them all carry on (#126).
      box.append(
        el('p', {
          text:
            item.scope === 'campaign'
              ? `${hero} stopped: the campaign reached its cap of $${(item.cap / 1_000_000).toFixed(2)}.`
              : `${hero} is out of gold.`,
        }),
      );
      actions.append(
        item.scope === 'campaign'
          ? intentButton({
              label: 'Raise the campaign cap by $5',
              intent: () => ({ type: 'raiseCampaignBudget', addMicroUsd: 5_000_000 }),
              client,
            })
          : intentButton({
              label: 'Raise the cap by $1',
              intent: () => ({ type: 'raiseBudget', heroId: item.heroId, addMicroUsd: 1_000_000 }),
              client,
            }),
        intentButton({
          label: 'Stop',
          intent: () => ({ type: 'stopHero', heroId: item.heroId }),
          client,
        }),
      );
      break;
    case 'reviewEscalation': {
      // The loop limit, or a reviewer that couldn't finish (§5.5, #141): the user settles it.
      // Who couldn't finish, and why (#264): the reviewer's own words, such as running out of gold.
      const failures = item.failures ?? [];
      box.append(
        el('p', {
          text:
            item.reason === 'loopLimit'
              ? `${hero}'s review went round too many times.`
              : `${failures.map((f) => councillorTitle(f.councillorId)).join(', ') || 'A reviewer'} couldn't finish reviewing ${hero}'s task.`,
        }),
        ...failures.map((f) =>
          el('p', { className: 'muted', text: `${councillorTitle(f.councillorId)}: ${f.reason}` }),
        ),
        findings(item.findings),
      );
      const note = el('textarea');
      note.rows = 2;
      note.setAttribute('aria-label', 'A note for the hero (optional)');
      note.placeholder = 'A note for the hero (optional)';
      if (failures.length > 0)
        actions.append(
          intentButton({
            label: 'Run again',
            intent: () => ({ type: 'resolveReview', itemId: item.id, decision: 'retry' }),
            client,
          }),
        );
      actions.append(
        intentButton({
          label: 'Accept anyway',
          intent: () => ({ type: 'resolveReview', itemId: item.id, decision: 'accept' }),
          client,
        }),
        note,
        intentButton({
          label: 'Send back',
          intent: () => ({
            type: 'resolveReview',
            itemId: item.id,
            decision: 'sendBack',
            ...(note.value.trim() ? { note: note.value.trim() } : {}),
          }),
          client,
        }),
        intentButton({
          label: 'Stop',
          intent: () => ({ type: 'resolveReview', itemId: item.id, decision: 'stop' }),
          client,
        }),
      );
      if (openTask)
        actions.append(button({ label: 'Open task', onClick: () => openTask(item.taskPointId) }));
      break;
    }
    case 'revisitDecision':
      // A recorded decision is the user's to reopen (§4.5): this only tells them; the council changes it.
      box.append(
        el('p', {
          text: `${councillorTitle(item.councillorId)} asks to revisit ${item.decisionId}: ${item.message}`,
        }),
        el('p', {
          className: 'muted',
          text: 'The decision stands. To change it, talk to the council.',
        }),
      );
      actions.append(
        intentButton({
          label: 'Dismiss',
          intent: () => ({ type: 'dismissItem', itemId: item.id }),
          client,
        }),
      );
      break;
    case 'dispute': {
      box.append(
        el('p', { text: `${hero} disputes the review: ${item.reason}` }),
        findings(item.findings),
      );
      const note = el('textarea');
      note.rows = 2;
      note.setAttribute('aria-label', 'A note for the hero (optional)');
      note.placeholder = 'A note for the hero (optional)';
      const decide = (decision: 'drop' | 'keep') => () => ({
        type: 'resolveDispute' as const,
        itemId: item.id,
        decision,
        ...(note.value.trim() ? { note: note.value.trim() } : {}),
      });
      actions.append(
        note,
        intentButton({ label: 'Drop the findings', intent: decide('drop'), client }),
        intentButton({ label: 'Keep them', intent: decide('keep'), client }),
      );
      if (openTask)
        actions.append(button({ label: 'Open task', onClick: () => openTask(item.taskPointId) }));
      break;
    }
  }
  box.append(actions);
  return box;
}

/** The findings an escalation or a dispute is about, by councillor. */
function findings(list: (Finding & { councillorId: string })[]): HTMLElement {
  const ul = el('ul', { className: 'findings' });
  for (const f of list) {
    const li = el('li');
    li.append(el('strong', { text: councillorTitle(f.councillorId) }), `: ${findingText(f)}`);
    ul.append(li);
  }
  return ul;
}
