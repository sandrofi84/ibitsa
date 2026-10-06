import type { ActionInfo } from '@ibitsa/protocol';

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
