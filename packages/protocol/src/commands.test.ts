import { describe, expect, it } from 'vitest';
import { parseCommand } from './commands';
import type { Command } from './commands.schema';

const valid: Command[] = [
  { type: 'hello', protocolVersion: 1 },
  { type: 'requestJournal' },
  { type: 'requestFiles', islandId: 'i2' },
  { type: 'forgetProjectRule', rule: 'Bash(npm test:*)' },
  { type: 'setAutoApprove', commandId: 'c10', on: true },
  { type: 'restHero', commandId: 'c11', heroId: 'h1' },
  {
    type: 'answerPermission',
    commandId: 'c9',
    itemId: 'n5',
    decision: 'allow',
    always: 'project',
  },
  { type: 'requestJournal', before: 120, limit: 100 },
  {
    type: 'sendMessage',
    commandId: 'c1',
    heroId: 'h1',
    text: 'also update the docs',
    priority: 'next',
  },
  {
    type: 'sendMessage',
    commandId: 'c2',
    heroId: 'h1',
    text: 'stop and look at auth.ts',
    priority: 'now',
  },
  { type: 'stopHero', commandId: 'c3', heroId: 'h1' },
  { type: 'answerPermission', commandId: 'c4', itemId: 'p1', decision: 'allow' },
  {
    type: 'answerPermission',
    commandId: 'c5',
    itemId: 'p1',
    decision: 'deny',
    note: 'not on main',
  },
  {
    type: 'answerQuestion',
    commandId: 'c6',
    itemId: 'q1',
    answers: { 'Which database?': 'Postgres', 'Which checks?': ['lint', 'tests'] },
  },
  { type: 'resumeHero', commandId: 'c7', heroId: 'h1' },
  { type: 'raiseBudget', commandId: 'c8', heroId: 'h1', addMicroUsd: 2_000_000 },
  { type: 'markDone', commandId: 'c9', heroId: 'h1' },
  {
    type: 'startQuest',
    commandId: 'c10',
    description: 'Fix the login redirect\nIt loops after logout.',
    heroName: 'Ranger Ilse',
    classId: 'ranger',
    baseRef: 'main',
  },
  { type: 'finishQuest', commandId: 'c11' },
  { type: 'abandonQuest', commandId: 'c12' },
  { type: 'removeWorktree', commandId: 'c13', islandId: 'i1' },
];

describe('parseCommand', () => {
  it.each(valid.map((c) => [c.type, c] as const))('accepts %s', (_, command) => {
    expect(parseCommand(command)).toEqual({ ok: true, command });
  });

  it('covers every command type', () => {
    expect(new Set(valid.map((c) => c.type)).size).toBe(17);
  });

  it.each([
    ['an unknown type', { type: 'deleteRepo', commandId: 'c1' }],
    ['a non-object', 'stopHero'],
    ['null', null],
    ['a missing commandId', { type: 'stopHero', heroId: 'h1' }],
    ['an empty commandId', { type: 'stopHero', commandId: '', heroId: 'h1' }],
    [
      'extra fields on answerPermission',
      { type: 'answerPermission', commandId: 'c1', itemId: 'p1', decision: 'allow', always: true },
    ],
    [
      'an unknown permission decision',
      { type: 'answerPermission', commandId: 'c1', itemId: 'p1', decision: 'maybe' },
    ],
    [
      'later priority (not in M1)',
      { type: 'sendMessage', commandId: 'c1', heroId: 'h1', text: 'hi', priority: 'later' },
    ],
    [
      'an empty message',
      { type: 'sendMessage', commandId: 'c1', heroId: 'h1', text: '', priority: 'next' },
    ],
    [
      'a fractional budget raise',
      { type: 'raiseBudget', commandId: 'c1', heroId: 'h1', addMicroUsd: 1.5 },
    ],
    ['a zero budget raise', { type: 'raiseBudget', commandId: 'c1', heroId: 'h1', addMicroUsd: 0 }],
    [
      'a blank hero name',
      {
        type: 'startQuest',
        commandId: 'c1',
        description: 'x',
        heroName: '   ',
        classId: 'ranger',
        baseRef: 'main',
      },
    ],
    [
      'non-string answers',
      { type: 'answerQuestion', commandId: 'c1', itemId: 'q1', answers: { q: 3 } },
    ],
    ['protocol version 0', { type: 'hello', protocolVersion: 0 }],
    ['a journal page over 500', { type: 'requestJournal', limit: 501 }],
    ['a negative journal index', { type: 'requestJournal', before: -1 }],
    [
      'an unknown always scope',
      {
        type: 'answerPermission',
        commandId: 'c1',
        itemId: 'p1',
        decision: 'allow',
        always: 'forever',
      },
    ],
    ['an empty rule to forget', { type: 'forgetProjectRule', rule: '' }],
    ['files without an island', { type: 'requestFiles' }],
    ['auto mode without on', { type: 'setAutoApprove', commandId: 'c1' }],
  ])('rejects %s', (_, input) => {
    const result = parseCommand(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('names the offending field', () => {
    const result = parseCommand({ type: 'stopHero', commandId: 'c1' });
    expect(result).toEqual({ ok: false, issues: [expect.stringContaining('heroId')] });
  });
});
