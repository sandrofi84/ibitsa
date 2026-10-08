import {
  applyAmendment,
  type Effort,
  type Plan,
  planIslands,
  type Snapshot,
} from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import { heroClasses } from './heroes';
import {
  capFromInput,
  heroNameFor,
  namesProblem,
  partyRows,
  REVIEW_EFFORTS,
  reviewEffortsFor,
} from './parties';
import type { PartyRow } from './parties.types';
import type {
  NewParty,
  PartyAssembly,
  PartyAssemblyOptions,
  PartyFields,
} from './party-assembly.types';
import { AGENTS_NOT_READY, readinessLine } from './party-check';
import type { PartyCheck } from './party-check.types';
import { councillorTitle } from './sitting-hut';

/**
 * Party assembly (spec §7.1 screen 4, #123): after the council's plan is approved, one row per island with
 * its hero's class, name and gold cap and the councillors who will review it; the base branch; for a
 * stacked plan, how its islands start. **Start the campaign** sends `startCampaign`. Plain DOM in a native
 * <dialog>, so it works from the keyboard alone.
 */
export function mountPartyAssembly({
  client,
  options,
}: {
  client: GameClient;
  options: PartyAssemblyOptions;
}): PartyAssembly {
  const dialog = el('dialog', { className: 'party-assembly' });
  dialog.setAttribute('aria-label', 'Assemble the parties');
  document.body.appendChild(dialog);
  let snapshot: Snapshot | null = null;
  client.onSnapshot((s) => {
    snapshot = s;
    if (dialog.open && s.campaign?.status !== 'planning') dialog.close();
  });

  function open(plan: Plan): void {
    if (dialog.open || snapshot?.campaign?.status !== 'planning') return;
    const { branching } = planIslands(plan);
    const form = el('form');
    const error = el('p', { className: 'error' });
    error.setAttribute('role', 'alert');

    const rows: PartyFields[] = [];
    const partyCheck = options.partyCheck;
    for (const row of partyRows(plan)) {
      rows.push(
        partyFields({
          row,
          taken: (self) => rows.filter((p) => p !== self).map((p) => p.name.value),
          partyCheck,
        }),
      );
    }
    // The classes whose agents must pass the party check (#199). Reviewer classes on ACP agents
    // (#201) join them when reviews are on.
    const classes = () => rows.map((r) => r.classSelect.value);

    const base = el('select');
    const repo = snapshot?.repo;
    for (const b of repo?.branches ?? []) base.add(new Option(b, b));
    base.value = repo?.defaultBranch ?? '';
    const repoNote = el('p', { className: 'note' });
    if (repo === null)
      repoNote.textContent = "This folder isn't a git repository: heroes need one.";
    else if (repo && repo.uncommittedChanges > 0) {
      const n = repo.uncommittedChanges;
      repoNote.textContent = `Your ${n} uncommitted change${n === 1 ? '' : 's'} won't be in the worktrees.`;
    }

    const together = el('input');
    const startMode = el('fieldset', { className: 'start-mode' });
    if (branching === 'stacked') {
      startMode.append(el('legend', { text: 'How the stacked islands start' }));
      const cleared = el('input');
      cleared.type = 'radio';
      cleared.name = 'stacked-start';
      cleared.checked = true;
      together.type = 'radio';
      together.name = 'stacked-start';
      const a = el('label');
      a.append(cleared, ' Each island when the one before is cleared');
      const b = el('label');
      b.append(together, ' Start them all now (later branches catch up after each turn)');
      startMode.append(a, b);
    }

    const parallel = snapshot?.campaign?.maxParallel ?? 2;
    const start = el('button', { text: 'Start the campaign' });
    start.type = 'submit';
    const refreshChecks = () => {
      for (const r of rows) r.refreshCheck();
      start.disabled = repo === null || !partyCheck.allReady(classes());
    };
    dialog.addEventListener('close', partyCheck.onChange(refreshChecks), { once: true });
    // A Claude class needs no check, so no answer would redraw after choosing one.
    for (const r of rows) r.classSelect.addEventListener('change', refreshChecks);
    refreshChecks();
    partyCheck.check(classes());
    form.append(
      el('h2', { text: 'Assemble the parties' }),
      el('p', {
        className: 'note',
        text: 'The council charted these possible locations of Ibitsa. Who sets out for each?',
      }),
      el('p', {
        className: 'note',
        text: `${branching === 'stacked' ? 'Stacked: each island builds on the one before.' : 'Separate: every island branches from the base.'} Up to ${parallel} ${parallel === 1 ? 'party works' : 'parties work'} at once; the others wait and start by themselves.`,
      }),
      ...rows.map((r) => r.box),
      field({ label: 'Start from branch', control: base }),
      repoNote,
      ...(branching === 'stacked' ? [startMode] : []),
      error,
      el('div', { className: 'actions' }),
    );
    form.lastElementChild?.append(
      start,
      button({ label: 'Cancel', onClick: () => dialog.close() }),
    );

    form.onsubmit = (e) => {
      e.preventDefault();
      error.textContent = '';
      const names = rows.map((r) => r.name.value);
      const caps = rows.map((r) => capFromInput({ text: r.cap.value, noCap: r.noCap.checked }));
      const problem =
        namesProblem(names) ??
        caps.flatMap((c) => (c.ok ? [] : [c.problem]))[0] ??
        (base.value ? undefined : 'Choose the branch to start from.') ??
        (partyCheck.allReady(classes()) ? undefined : AGENTS_NOT_READY);
      if (problem) {
        error.textContent = problem;
        return;
      }
      const chosen = rows.map((r) => ({ islandId: r.row.islandId, ...partyChoice(r) }));
      const intent = {
        type: 'startCampaign' as const,
        baseRef: base.value,
        parties: chosen,
        ...(branching === 'stacked'
          ? { stackedStart: together.checked ? ('together' as const) : ('cleared' as const) }
          : {}),
      };
      dialog.close();
      options.withCredentials(() => client.send(intent));
    };
    dialog.replaceChildren(form);
    dialog.showModal();
    rows[0]?.classSelect.focus();
  }

  return { open };
}

/**
 * One island's party (§7.1 screen 4): hero class and name, gold cap, and a review effort for each
 * councillor who reviews it. `taken` names the other parties' heroes, for a fresh default name.
 */
export function partyFields({
  row,
  taken,
  partyCheck,
}: {
  row: PartyRow;
  taken: (self: PartyFields) => string[];
  partyCheck: PartyCheck;
}): PartyFields {
  const box = el('fieldset', { className: 'party' });
  box.append(el('legend', { text: `${row.islandId} ${row.title}` }));
  box.append(el('p', { className: 'tasks', text: row.tasks.join(' · ') }));
  const classSelect = el('select');
  for (const c of heroClasses()) classSelect.add(new Option(`${c.label} (${c.model})`, c.id));
  classSelect.value = row.classId;
  // Its agent's party check (#199): nothing for a Claude class.
  const checkLine = el('div', { className: 'party-check' });
  const refreshCheck = () =>
    checkLine.replaceChildren(readinessLine({ partyCheck, classId: classSelect.value }));
  refreshCheck();
  const name = el('input');
  name.value = row.heroName;
  let named = false;
  name.oninput = () => {
    named = true;
  };
  const cap = el('input');
  cap.inputMode = 'decimal';
  cap.placeholder = 'Default';
  const noCap = el('input');
  noCap.type = 'checkbox';
  noCap.onchange = () => {
    cap.disabled = noCap.checked;
  };
  const noCapLabel = el('label', { className: 'inline' });
  noCapLabel.append(noCap, ' No cap');
  // One review effort per reviewing councillor (§5.5, #139): Light by default.
  const efforts = row.councillors.map((councillorId) => {
    const select = el('select');
    for (const e of REVIEW_EFFORTS) select.add(new Option(e.label, e.id));
    select.value = 'light';
    return { councillorId, select };
  });
  const reviews = el('div', { className: 'reviews' });
  if (efforts.length === 0) {
    reviews.append(
      el('p', {
        className: 'note',
        text: 'Nobody reviews this island: its checks are enough.',
      }),
    );
  } else {
    reviews.append(el('p', { className: 'note', text: 'Reviewed by:' }));
    for (const e of efforts) {
      reviews.append(
        field({
          label: `${councillorTitle(e.councillorId)}, review effort`,
          control: e.select,
        }),
      );
    }
  }
  box.append(
    field({ label: 'Hero class', control: classSelect }),
    checkLine,
    field({ label: 'Hero name', control: name }),
    field({ label: 'Gold cap in dollars', control: cap }),
    noCapLabel,
    reviews,
  );
  const fields: PartyFields = { row, box, classSelect, name, cap, noCap, efforts, refreshCheck };
  classSelect.onchange = () => {
    if (!named) name.value = heroNameFor({ classId: classSelect.value, taken: taken(fields) });
    partyCheck.check([classSelect.value]);
    refreshCheck();
  };
  return fields;
}

/** What a party's fields say: its hero, gold cap and review efforts, as a command takes them. */
export function partyChoice(fields: PartyFields): {
  heroName: string;
  classId: string;
  budgetMicroUsd?: number | null;
  reviewEfforts?: Record<string, Effort>;
} {
  const cap = capFromInput({ text: fields.cap.value, noCap: fields.noCap.checked });
  const budget = cap.ok ? cap.budgetMicroUsd : undefined;
  return {
    heroName: fields.name.value.trim(),
    classId: fields.classSelect.value,
    ...(budget === undefined ? {} : { budgetMicroUsd: budget }),
    ...reviewEffortsFor({
      councillors: fields.row.councillors,
      chosen: Object.fromEntries(fields.efforts.map((e) => [e.councillorId, e.select.value])),
    }),
  };
}

/**
 * The party of an island an amendment added (#170): the same fields as party assembly, for that one
 * island; **Assemble** sends `assembleParty`, and the island waits for a slot like the others.
 */
export function mountNewParty({
  client,
  partyCheck,
}: {
  client: GameClient;
  partyCheck: PartyCheck;
}): NewParty {
  const dialog = el('dialog', { className: 'party-assembly new-party' });
  dialog.setAttribute('aria-label', 'Assemble the new party');
  document.body.appendChild(dialog);

  function open(islandId: string): void {
    const snapshot = client.snapshot;
    const island = snapshot?.islands.find((i) => i.id === islandId);
    const plan = snapshot ? amendedPlan(snapshot) : undefined;
    const row = plan && partyRows(plan).find((r) => r.islandId === island?.planIslandId);
    if (!island?.awaitingParty || !row || dialog.open) return;
    const heroes = snapshot?.heroes.map((h) => h.name) ?? [];
    const fields = partyFields({
      row: { ...row, heroName: heroNameFor({ classId: row.classId, taken: heroes }) },
      taken: () => heroes,
      partyCheck,
    });
    const error = el('p', { className: 'error' });
    error.setAttribute('role', 'alert');
    const form = el('form');
    const assemble = el('button', { text: 'Assemble' });
    assemble.type = 'submit';
    const refreshCheck = () => {
      fields.refreshCheck();
      assemble.disabled = !partyCheck.allReady([fields.classSelect.value]);
    };
    dialog.addEventListener('close', partyCheck.onChange(refreshCheck), { once: true });
    fields.classSelect.addEventListener('change', refreshCheck);
    refreshCheck();
    partyCheck.check([fields.classSelect.value]);
    const actions = el('div', { className: 'actions' });
    actions.append(assemble, button({ label: 'Cancel', onClick: () => dialog.close() }));
    form.append(
      el('h2', { text: `A party for ${island.name}` }),
      el('p', {
        className: 'note',
        text: 'An amendment added this island. Once its party is assembled it starts when a slot is free.',
      }),
      fields.box,
      error,
      actions,
    );
    form.onsubmit = (e) => {
      e.preventDefault();
      const cap = capFromInput({ text: fields.cap.value, noCap: fields.noCap.checked });
      const problem =
        namesProblem([...heroes, fields.name.value]) ??
        (cap.ok ? undefined : cap.problem) ??
        (partyCheck.allReady([fields.classSelect.value]) ? undefined : AGENTS_NOT_READY);
      if (problem) {
        error.textContent = problem;
        return;
      }
      dialog.close();
      client.send({ type: 'assembleParty', islandId, ...partyChoice(fields) });
    };
    dialog.replaceChildren(form);
    dialog.showModal();
    fields.classSelect.focus();
  }

  return { open };
}

/** The approved plan with its approved amendments, as core has it (#170). */
export function amendedPlan(snapshot: Snapshot): Plan | undefined {
  const sitting = snapshot.sitting;
  const plan = sitting?.plans.filter((p) => p.outcome.kind === 'approved').at(-1)?.plan;
  if (!sitting || !plan) return undefined;
  return sitting.amendments
    .filter((a) => a.outcome.kind === 'approved')
    .reduce((p, a) => applyAmendment({ plan: p, amendment: a.amendment }), plan);
}

function field({ label, control }: { label: string; control: HTMLElement }): HTMLLabelElement {
  const wrapper = el('label');
  wrapper.append(el('span', { text: label }), control);
  return wrapper;
}
