import type { ActionDraft, ActionInfo, ActionPreview } from '@ibitsa/protocol';
import type { DevActionReply } from './dev-actions.types';

/** What the standalone build's `/` menu offers (#84): Ibitsa's built-ins and one project skill. */
export const DEV_ACTIONS: ActionInfo[] = [
  {
    name: 'ibitsa:test',
    description: 'Run the tests and fix what fails',
    argumentHint: '[filter]',
    aliases: ['test'],
    source: 'plugin',
    target: 'hero',
  },
  {
    name: 'ibitsa:tidy',
    description: 'Run the linter and formatter and fix what they report',
    argumentHint: '',
    aliases: ['tidy'],
    source: 'plugin',
    target: 'hero',
  },
  {
    name: 'ibitsa:explain',
    description: 'Explain the changes on this branch, without editing anything',
    argumentHint: '[focus]',
    aliases: ['explain'],
    source: 'plugin',
    target: 'hero',
  },
  {
    name: 'pr',
    description: 'Open a pull request for the current task',
    argumentHint: '[reviewers]',
    aliases: [],
    source: 'project',
    target: 'any',
  },
];

const DEV_PROMPTS: Record<string, string> = {
  'ibitsa:test': "Run this project's tests. Only these tests if given: $ARGUMENTS",
  'ibitsa:tidy': "Run this project's linter and formatter, then fix what they report.",
  'ibitsa:explain': 'Explain the changes on the current branch. Focus on, if given: $ARGUMENTS',
  pr: 'Open a pull request for the current task. Request review from: $ARGUMENTS',
};

/** The standalone build's previews: the prompts above with their arguments filled in (#85). */
export function devPreview({ name, args }: { name: string; args: string }): ActionPreview {
  const prompt = DEV_PROMPTS[name];
  return {
    name,
    args,
    text: prompt === undefined ? null : prompt.replaceAll('$ARGUMENTS', args.trim()),
    notes: [],
  };
}

/**
 * The standalone build's `/` menu (#84, #86): the fixed list above, plus actions created in the page,
 * kept in memory. A name already in the list is a clash unless overwriting.
 */
export class DevActions {
  private actions: ActionInfo[] = [...DEV_ACTIONS];

  get list(): ActionInfo[] {
    return [...this.actions];
  }

  create({ draft, overwrite }: { draft: ActionDraft; overwrite: boolean }): DevActionReply[] {
    const taken = this.actions.some((a) => a.name === draft.name || a.aliases.includes(draft.name));
    if (taken && !overwrite) {
      return [
        {
          type: 'actionRejected',
          name: draft.name,
          reason: `There is already a skill named ${draft.name}.`,
          clash: true,
        },
      ];
    }
    this.actions = [
      ...this.actions.filter((a) => a.name !== draft.name),
      {
        name: draft.name,
        description: draft.description,
        argumentHint: draft.argumentHint,
        aliases: [],
        source: draft.scope === 'personal' ? 'user' : 'project',
        target: draft.target,
      },
    ];
    return [
      { type: 'actionCreated', name: draft.name },
      { type: 'actions', actions: this.list },
    ];
  }
}
