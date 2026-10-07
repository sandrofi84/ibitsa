import type { ElderView, Plan, SittingView, Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import type { ElderPanelOptions } from './elder-panel.types';
import { gold } from './hero-pane';
import { planDetails } from './plan-review';
import { isSitting } from './sitting-hut';

/** How many files the panel lists; the rest are in `brief.md`. */
const FILES_SHOWN = 8;

/**
 * The elder's recommendation (spec §7.1 screen 1, #101): research progress, then the brief's summary
 * with a quick quest or the council. Plain DOM docked where the hero pane goes, shown while the campaign
 * is planning.
 */
export function mountElderPanel({
  client,
  options,
}: {
  client: GameClient;
  options: ElderPanelOptions;
}): void {
  const panel = el('section', { className: 'elder-panel' });
  panel.setAttribute('aria-label', 'Elder');
  panel.hidden = true;
  document.body.appendChild(panel);
  let shown: string | null = null;

  client.onSnapshot((snapshot: Snapshot) => {
    // While the council sits the hut takes over; the panel comes back when the sitting ends.
    const planning = snapshot.campaign?.status === 'planning' && !isSitting(snapshot.sitting);
    const approved =
      planning && snapshot.sitting?.status === 'approved'
        ? snapshot.sitting.plans.find((p) => p.outcome.kind === 'approved')
        : undefined;
    const elder = planning ? snapshot.elder : null;
    panel.hidden = !elder && !approved;
    if (approved) {
      const sitting = snapshot.sitting as SittingView;
      const key = `plan:${sitting.id}:${approved.version}:${sitting.rating?.score ?? ''}`;
      if (key === shown) return;
      shown = key;
      panel.replaceChildren(...renderPlan({ plan: approved.plan, sitting }));
      return;
    }
    if (!elder) {
      shown = null;
      return;
    }
    // Rebuild only when something visible changed, so focus stays put between snapshots.
    const key = JSON.stringify([elder.status, elder.progress, elder.gold, elder.error, elder.id]);
    if (key === shown) return;
    shown = key;
    panel.replaceChildren(...render(elder));
  });

  /** The approved plan (#104): what the hero will work through, and Start the quest. */
  function renderPlan({ plan, sitting }: { plan: Plan; sitting: SittingView }): HTMLElement[] {
    const start = button({ label: 'Assemble the parties', onClick: () => options.assemble(plan) });
    start.classList.add('recommended');
    return [
      el('h2', { text: "The council's plan" }),
      el('p', { className: 'verdict', text: `Approved. ${plan.summary}` }),
      ...planDetails(plan),
      rating({ client, sitting }),
      otherWay({ client, sitting }),
      actions(
        start,
        button({ label: 'Abandon', onClick: () => client.send({ type: 'abandonQuest' }) }),
      ),
    ];
  }

  function render(elder: ElderView): HTMLElement[] {
    const heading = el('h2', { text: 'The elder' });
    const cost = el('p', { className: 'gold', text: `Gold spent: ${gold(elder.gold)}` });
    const abandon = button({
      label: 'Abandon',
      onClick: () => client.send({ type: 'abandonQuest' }),
    });
    if (elder.status === 'researching') {
      const status = el('p', { className: 'progress', text: elder.progress ?? 'Starting…' });
      status.setAttribute('aria-live', 'polite');
      return [heading, el('p', { text: 'Researching your task…' }), status, cost, actions(abandon)];
    }
    if (elder.status === 'failed' || !elder.brief) {
      const error = el('p', { className: 'error', text: elder.error ?? 'The research failed.' });
      error.setAttribute('role', 'alert');
      return [
        heading,
        error,
        cost,
        actions(
          button({
            label: 'Ask again',
            onClick: () => client.send({ type: 'consultElder', task: elder.task }),
          }),
          button({ label: 'Quick quest anyway', onClick: () => options.quickQuest(elder.task) }),
          abandon,
        ),
      ];
    }
    const brief = elder.brief;
    const verdict = el('p', {
      className: brief.quickQuest.recommended ? 'verdict quick' : 'verdict council',
      text: `${brief.quickQuest.recommended ? 'A quick quest will do.' : 'This needs the council.'} ${brief.quickQuest.reason}`,
    });
    const files = el('ul', { className: 'files' });
    for (const f of brief.files.slice(0, FILES_SHOWN)) {
      const li = el('li');
      li.append(el('code', { text: f.lines ? `${f.path}:${f.lines}` : f.path }), ` ${f.note}`);
      files.append(li);
    }
    if (brief.files.length > FILES_SHOWN) {
      files.append(el('li', { text: `…and ${brief.files.length - FILES_SHOWN} more in brief.md` }));
    }
    const findings = el('ul', { className: 'findings' });
    for (const f of brief.findings) findings.append(el('li', { text: f }));
    const councillors = el('ul', { className: 'councillors' });
    for (const c of brief.councillors) {
      const li = el('li');
      li.append(el('strong', { text: c.councillorId }), ` ${c.reason}`);
      councillors.append(li);
    }
    // Past campaigns whose records bear on this task, and whether a kept council's work is related (#168).
    const related = el('ul', { className: 'related' });
    for (const c of brief.relatedCampaigns ?? []) {
      const li = el('li');
      li.append(el('strong', { text: c.title }), ` ${c.why}`);
      related.append(li);
    }
    const kept = brief.keptContext;
    const keptNote = kept
      ? el('p', {
          className: 'note kept-context',
          text: kept.related
            ? `The council's kept context fits this task: ${kept.reason}`
            : `Unrelated to the council's kept context: ${kept.reason} Start fresh when you convene.`,
        })
      : null;
    const quick = button({ label: 'Quick quest', onClick: () => options.quickQuest(elder.task) });
    const convene = button({ label: 'Convene council', onClick: () => options.convene() });
    const recommended = brief.quickQuest.recommended ? quick : convene;
    recommended.classList.add('recommended');
    return [
      heading,
      el('p', { className: 'task', text: brief.task }),
      verdict,
      section('Files', files),
      ...(brief.findings.length > 0 ? [section('Findings', findings)] : []),
      ...(brief.councillors.length > 0 ? [section('Recommended councillors', councillors)] : []),
      ...((brief.relatedCampaigns ?? []).length > 0 ? [section('Related campaigns', related)] : []),
      ...(keptNote ? [keptNote] : []),
      cost,
      actions(quick, convene, abandon),
    ];
  }
}

function section(title: string, body: HTMLElement): HTMLElement {
  const s = el('div', { className: 'brief-section' });
  s.append(el('h3', { text: title }), body);
  return s;
}

function actions(...buttons: HTMLButtonElement[]): HTMLElement {
  const row = el('div', { className: 'actions' });
  row.append(...buttons);
  return row;
}

/**
 * "How useful was the council?" (§4.10, #106): 1–5 and an optional note, once. Optional: the plan can be
 * carried out without it.
 */
function rating({ client, sitting }: { client: GameClient; sitting: SittingView }): HTMLElement {
  const box = el('fieldset', { className: 'rating' });
  box.append(el('legend', { text: 'How useful was the council?' }));
  if (sitting.rating) {
    box.append(el('p', { text: `You rated it ${sitting.rating.score} of 5. Thank you.` }));
    return box;
  }
  const note = el('input');
  note.placeholder = 'A note (optional)';
  note.setAttribute('aria-label', 'A note about the council (optional)');
  const scores = el('div', { className: 'scores' });
  for (let score = 1; score <= 5; score++) {
    const b = button({
      label: String(score),
      onClick: () =>
        client.send({
          type: 'rateSitting',
          sittingId: sitting.id,
          score,
          ...(note.value.trim() ? { note: note.value.trim() } : {}),
        }),
    });
    b.setAttribute('aria-label', `${score} of 5`);
    scores.append(b);
  }
  box.append(scores, note, el('p', { className: 'note', text: '1 not useful, 5 very useful.' }));
  return box;
}

/**
 * Convene the other way (§4.10, #106): the same task and councillors, in the other mode, to compare.
 * It costs a second sitting, so it asks first.
 */
function otherWay({ client, sitting }: { client: GameClient; sitting: SittingView }): HTMLElement {
  const other = sitting.mode === 'roundTable' ? 'chambers' : 'roundTable';
  const name = other === 'chambers' ? 'in separate chambers' : 'at a round table';
  const box = el('div', { className: 'other-way' });
  const ask = button({
    label: 'Convene the other way',
    onClick: () => {
      const confirm = el('p', {
        text: `The council sits again ${name} on the same task, to compare. That costs a second sitting. Convene?`,
      });
      const yes = button({
        label: `Yes, sit ${name}`,
        onClick: () =>
          client.send({
            type: 'conveneCouncil',
            task: sitting.task,
            mode: other,
            roster: sitting.roster.map((c) => c.councillorId),
            effort: sitting.effort,
            ...(other === 'chambers'
              ? {
                  councillorEfforts: Object.fromEntries(
                    sitting.roster.map((c) => [c.councillorId, c.effort]),
                  ),
                }
              : {}),
            comparisonOf: sitting.id,
          }),
      });
      box.replaceChildren(
        confirm,
        actions(yes, button({ label: 'No', onClick: () => box.replaceChildren(ask) })),
      );
      yes.focus();
    },
  });
  box.append(ask);
  return box;
}
