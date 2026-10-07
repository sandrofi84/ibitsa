import type { CampaignEndInput, CampaignEndModel } from './campaign-end.types';
import type { GameClient } from './client';
import { button, el } from './dom';

const CHOSEN = {
  empty: 'The council starts fresh next time; the record keeps what it learned.',
  compact: 'The council’s context is compacted and kept for the next campaign.',
  keep: 'The council’s context is kept for the next campaign.',
};

/** The end of a campaign in words and choices (spec §4.9, #167): a plain function of the snapshot. */
export function campaignEndOf({ status, ending }: CampaignEndInput): CampaignEndModel {
  const record = {
    lessons: 'The elder is writing the lessons…',
    writing: 'Writing the campaign record…',
    written: `The campaign record is in ${ending.recordPath ?? 'the campaign folder'}.`,
    failed: `The campaign record couldn't be written: ${ending.recordError ?? 'no reason given'}`,
  }[ending.record];
  const pending = ending.councilContext === 'pending';
  const size =
    ending.councilTokens === null
      ? ''
      : ` It holds about ${Math.round(ending.councilTokens / 1000)}k tokens.`;
  return {
    heading: status === 'abandoned' ? 'The campaign was abandoned' : 'The campaign is over',
    record,
    question: pending ? `What happens to the council’s context?${size}` : null,
    choices: pending
      ? [
          {
            id: 'empty',
            label: 'Empty',
            note: 'Start fresh next time (the record keeps the knowledge).',
          },
          {
            id: 'compact',
            label: 'Compact',
            note: 'Summarize it now and continue from the summary.',
          },
          {
            id: 'keep',
            label: 'Keep',
            note: 'The next campaign picks up where this council left off.',
          },
        ]
      : [],
    chosen:
      ending.councilContext && ending.councilContext !== 'pending'
        ? CHOSEN[ending.councilContext]
        : null,
    closable: !pending && (ending.record === 'written' || ending.record === 'failed'),
  };
}

/**
 * The dialog at a campaign's end (§4.9): the record being written, then (after Finish) what happens to
 * the council's context, Empty first. It opens once per campaign and closes when you're done with it.
 */
export function mountCampaignEnd({ client }: { client: GameClient }): void {
  const dialog = el('section', { className: 'campaign-end' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-labelledby', 'campaign-end-title');
  dialog.hidden = true;
  document.body.appendChild(dialog);
  let dismissed: string | null = null;
  let shown = '';

  client.onSnapshot((snapshot) => {
    const campaign = snapshot.campaign;
    const ending = campaign?.ending;
    if (!campaign || !ending || campaign.status === 'active' || campaign.status === 'planning') {
      dialog.hidden = true;
      return;
    }
    if (dismissed === campaign.id) return;
    const model = campaignEndOf({ status: campaign.status, ending });
    const key = JSON.stringify(model);
    if (key === shown && !dialog.hidden) return;
    shown = key;
    const heading = el('h2', { text: model.heading });
    heading.id = 'campaign-end-title';
    const parts: HTMLElement[] = [
      heading,
      el('p', { className: 'campaign-record', text: model.record }),
    ];
    if (model.question) {
      parts.push(el('p', { text: model.question }));
      for (const choice of model.choices) {
        const row = el('div', { className: 'campaign-choice' });
        row.append(
          button({
            label: choice.label,
            onClick: () => client.send({ type: 'chooseCouncilContext', choice: choice.id }),
          }),
          el('span', { className: 'note', text: choice.note }),
        );
        parts.push(row);
      }
    }
    if (model.chosen) parts.push(el('p', { className: 'note', text: model.chosen }));
    if (model.closable) {
      parts.push(
        button({
          label: 'Close',
          onClick: () => {
            dismissed = campaign.id;
            dialog.hidden = true;
          },
        }),
      );
    }
    dialog.replaceChildren(...parts);
    const opening = dialog.hidden;
    dialog.hidden = false;
    // Empty is the default: it has the focus when the choice appears.
    if (opening || model.question) dialog.querySelector<HTMLButtonElement>('button')?.focus();
  });
}
