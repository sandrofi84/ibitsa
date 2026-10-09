import { COUNCIL_RESUME } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { ResumeItem, ResumeOfferInput, ResumeOfferModel } from './resume-offer.types';

/**
 * About what writing a conversation back into the prompt cache costs, in dollars per million tokens
 * (1.25 × input), by model family: what a resume's first turn pays once the cache has gone cold. A
 * rough guide for the dialog, not a bill; an unknown model gives no estimate.
 */
const CACHE_WRITE_USD_PER_MTOK: readonly [family: string, usd: number][] = [
  ['opus', 5],
  ['sonnet', 2.5],
  ['haiku', 1.25],
];

/** About what resuming a conversation of `tokens` on `model` costs in its first turn; null if unknown. */
export function resumeCost({ tokens, model }: { tokens: number; model: string }): number | null {
  const family = CACHE_WRITE_USD_PER_MTOK.find(([name]) => model.toLowerCase().includes(name));
  return family ? (tokens / 1_000_000) * family[1] : null;
}

/** "3 min", "2 h", "1 day": how long since a session was last heard from. */
export function idleText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day' : `${days} days`;
}

const money = (usd: number) => (usd < 0.01 ? 'under $0.01' : `about $${usd.toFixed(2)}`);

/** The resume dialog in words (#293): a plain function of the snapshot, so it's testable. */
export function resumeOfferOf({ offer, heroes, classes }: ResumeOfferInput): ResumeOfferModel {
  const items: ResumeItem[] = offer.heroes.map(({ heroId, idleMs }) => {
    const hero = heroes.find((h) => h.id === heroId);
    const model = classes.find((c) => c.id === hero?.classId)?.model ?? '';
    const tokens = hero?.hp.kind === 'unknown' ? null : (hero?.hp.value.used ?? null);
    const cost = tokens === null ? null : resumeCost({ tokens, model });
    const parts = [
      idleMs === null ? null : `idle ${idleText(idleMs)}`,
      tokens === null ? null : `${Math.round(tokens / 1000)}k tokens of conversation`,
      cost === null ? 'cost unknown' : `${money(cost)} for its first turn back`,
    ];
    return {
      id: heroId,
      label: hero?.name ?? heroId,
      detail: parts.filter(Boolean).join(', '),
    };
  });
  if (offer.council) {
    const idle = offer.council.idleMs;
    items.push({
      id: COUNCIL_RESUME,
      label: 'The council',
      detail: [
        idle === null ? null : `idle ${idleText(idle)}`,
        'its first turn back re-reads the whole sitting',
      ]
        .filter(Boolean)
        .join(', '),
    });
  }
  return { items };
}

/**
 * The dialog after a reload when something would resume (§12, #293): what would, since when and about
 * what it costs, then Resume all, Choose…, Don't resume now or Abandon the campaign. Nothing resumes
 * until the user answers; closing it is "Don't resume now".
 */
export function mountResumeOffer({ client }: { client: GameClient }): void {
  const dialog = el('section', { className: 'resume-offer' });
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-labelledby', 'resume-offer-title');
  dialog.hidden = true;
  document.body.appendChild(dialog);
  let shown = '';
  let choosing = false;

  const answer = (resume: string[]) => {
    client.send({ type: 'answerResume', resume });
    dialog.hidden = true;
  };
  const draw = (model: ResumeOfferModel) => {
    const heading = el('h2', { text: 'Resume where things left off?' });
    heading.id = 'resume-offer-title';
    const list = el('ul', { className: 'resume-items' });
    const boxes: { id: string; box: HTMLInputElement }[] = [];
    for (const item of model.items) {
      const row = el('li');
      const label = el('label');
      if (choosing) {
        const box = el('input');
        box.type = 'checkbox';
        box.checked = true;
        boxes.push({ id: item.id, box });
        label.append(box, ' ');
      }
      label.append(el('strong', { text: item.label }), ` — ${item.detail}`);
      row.append(label);
      list.append(row);
    }
    const all = model.items.map((i) => i.id);
    const actions = el('div', { className: 'resume-actions' });
    actions.append(
      choosing
        ? button({
            label: 'Resume these',
            onClick: () => answer(boxes.filter((b) => b.box.checked).map((b) => b.id)),
          })
        : button({ label: 'Resume all', onClick: () => answer(all) }),
      ...(choosing || model.items.length < 2
        ? []
        : [
            button({
              label: 'Choose…',
              onClick: () => {
                choosing = true;
                draw(model);
              },
            }),
          ]),
      button({ label: "Don't resume now", onClick: () => answer([]) }),
      button({
        label: 'Abandon the campaign',
        onClick: () => {
          answer([]);
          client.send({ type: 'abandonQuest' });
        },
      }),
    );
    dialog.replaceChildren(
      heading,
      el('p', {
        text: 'VS Code reloaded. Each resume sends its whole conversation again, which costs more after a break. Nothing resumes until you choose; what waits picks up with your next message.',
      }),
      list,
      actions,
    );
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
  };

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') answer([]);
  });
  client.onSnapshot((snapshot) => {
    const offer = snapshot.resumeOffer;
    if (!offer) {
      dialog.hidden = true;
      shown = '';
      choosing = false;
      return;
    }
    const model = resumeOfferOf({
      offer,
      heroes: snapshot.heroes,
      classes: snapshot.classes ?? [],
    });
    const key = JSON.stringify(model);
    if (key === shown && !dialog.hidden) return;
    shown = key;
    dialog.hidden = false;
    draw(model);
  });
}
