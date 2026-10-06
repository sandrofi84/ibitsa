import type { ActionDraft } from '@ibitsa/protocol';

/** A skill's name: lowercase letters, digits and single dashes, e.g. `pr-summary` (#86). */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What's wrong with a draft before it's sent, in the order the form shows its fields. */
export function draftProblems(draft: ActionDraft): string[] {
  const problems: string[] = [];
  if (!draft.name) problems.push('Give the action a name.');
  else if (!NAME.test(draft.name) || draft.name.length > 64) {
    problems.push('Use lowercase letters, digits and single dashes for the name, e.g. pr-summary.');
  }
  if (!draft.description.trim()) problems.push('Say in a few words what the action does.');
  if (!draft.prompt.trim()) problems.push('Write the prompt the hero gets.');
  return problems;
}

/** A free name after a clash: `name-2`, `name-3`, … */
export function renamed({ name, taken }: { name: string; taken: readonly string[] }): string {
  for (let n = 2; ; n++) {
    const candidate = `${name}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}
