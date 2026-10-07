import { type Plan, planIslands, type Snapshot } from '@ibitsa/protocol';
import type { GameClient } from './client';
import { button, el } from './dom';
import { HERO_CLASSES } from './heroes';
import { capFromInput, heroNameFor, namesProblem, partyRows } from './parties';
import type { PartyAssembly, PartyAssemblyOptions } from './party-assembly.types';
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

    const rows = partyRows(plan).map((row) => {
      const box = el('fieldset', { className: 'party' });
      box.append(el('legend', { text: `${row.islandId} ${row.title}` }));
      box.append(el('p', { className: 'tasks', text: row.tasks.join(' · ') }));
      const classSelect = el('select');
      for (const c of HERO_CLASSES) classSelect.add(new Option(`${c.label} (${c.model})`, c.id));
      classSelect.value = row.classId;
      const name = el('input');
      name.value = row.heroName;
      let named = false;
      name.oninput = () => {
        named = true;
      };
      classSelect.onchange = () => {
        if (named) return;
        const taken = rows.filter((p) => p.name !== name).map((p) => p.name.value);
        name.value = heroNameFor({ classId: classSelect.value, taken });
      };
      const cap = el('input');
      cap.inputMode = 'decimal';
      cap.placeholder = 'Default';
      const noCap = el('input');
      noCap.type = 'checkbox';
      noCap.onchange = () => {
        cap.disabled = noCap.checked;
      };
      const reviewers =
        row.councillors.length > 0 ? row.councillors.map(councillorTitle).join(', ') : 'No one yet';
      const noCapLabel = el('label', { className: 'inline' });
      noCapLabel.append(noCap, ' No cap');
      box.append(
        field({ label: 'Hero class', control: classSelect }),
        field({ label: 'Hero name', control: name }),
        field({ label: 'Gold cap in dollars', control: cap }),
        noCapLabel,
        el('p', { className: 'note', text: `Reviewed by: ${reviewers} (reviews arrive with M5).` }),
      );
      return { row, box, classSelect, name, cap, noCap };
    });

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
    start.disabled = repo === null;
    form.append(
      el('h2', { text: 'Assemble the parties' }),
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
        (base.value ? undefined : 'Choose the branch to start from.');
      if (problem) {
        error.textContent = problem;
        return;
      }
      const chosen = rows.map((r, i) => {
        const cap = caps[i];
        const budget = cap?.ok ? cap.budgetMicroUsd : undefined;
        return {
          islandId: r.row.islandId,
          heroName: r.name.value.trim(),
          classId: r.classSelect.value,
          ...(budget === undefined ? {} : { budgetMicroUsd: budget }),
        };
      });
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

function field({ label, control }: { label: string; control: HTMLElement }): HTMLLabelElement {
  const wrapper = el('label');
  wrapper.append(el('span', { text: label }), control);
  return wrapper;
}
