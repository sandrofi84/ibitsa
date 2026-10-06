import { describe, expect, it } from 'vitest';
import type { LogRecord } from './event-log.types';
import { Journal } from './journal';
import { DEFAULT_SETTINGS, initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';

type Input = LogRecord extends infer R ? (R extends unknown ? Omit<R, 't'> : never) : never;

/** Steps each input through core and feeds the journal, as the runtime does. */
function journalOf(inputs: Input[]): Journal {
  const journal = new Journal();
  let state: CoreState = initialState();
  inputs.forEach((input, i) => {
    const record = { ...input, t: i * 100 } as LogRecord;
    state = step(state, record).state;
    journal.add({ record, state });
  });
  return journal;
}

const quest: Input[] = [
  { kind: 'gm', event: { type: 'questSettings', ...DEFAULT_SETTINGS } },
  {
    kind: 'command',
    command: {
      type: 'startQuest',
      commandId: 'q1',
      description: 'Fix the login redirect\nIt loops.',
      heroName: 'Ranger Ilse',
      classId: 'ranger',
      baseRef: 'main',
    },
  },
  {
    kind: 'gm',
    event: { type: 'worktreeCreated', islandId: 'i2', path: '/wt', branch: 'ibitsa/fix' },
  },
  { kind: 'agent', heroId: 'h4', event: { type: 'sessionStarted', sessionId: 's1' } },
];

describe('Journal', () => {
  it('turns a quest into readable lines', () => {
    const journal = journalOf([
      ...quest,
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityStarted', toolUseId: 'u1', kind: 'test', detail: 'pnpm test' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityFinished', toolUseId: 'u1', outcome: 'failed' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'message', text: 'The test fails; fixing it.' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: {
          type: 'permission',
          requestId: 'r1',
          tool: 'Bash',
          input: { command: 'git commit' },
        },
      },
      {
        kind: 'command',
        command: {
          type: 'answerPermission',
          commandId: 'a1',
          itemId: 'n5',
          decision: 'allow',
          note: 'ok',
        },
      },
      {
        kind: 'command',
        command: {
          type: 'sendMessage',
          commandId: 'm1',
          heroId: 'h4',
          text: 'Add a test',
          priority: 'now',
        },
      },
      { kind: 'command', command: { type: 'stopHero', commandId: 's1', heroId: 'h4' } },
      { kind: 'gm', event: { type: 'runtimeRestarted' } },
      { kind: 'command', command: { type: 'resumeHero', commandId: 'r2', heroId: 'h4' } },
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'taskSubmitted', toolUseId: 'u9', summary: 'Fixed the redirect.' },
      },
      { kind: 'gm', event: { type: 'submitChecked', heroId: 'h4', toolUseId: 'u9', ok: true } },
      { kind: 'command', command: { type: 'finishQuest', commandId: 'f1' } },
      { kind: 'gm', event: { type: 'worktreeRemoved', islandId: 'i2' } },
    ]);
    expect(
      journal.entries.map((e) => [
        e.kind,
        'text' in e ? e.text : `${e.activity} ${e.detail} ${e.outcome}`,
      ]),
    ).toEqual([
      ['event', 'Quest started: Fix the login redirect'],
      ['event', 'Worktree ready on ibitsa/fix.'],
      ['tool', 'test pnpm test failed'],
      ['said', 'The test fails; fixing it.'],
      ['asked', 'Asks to run command: git commit'],
      ['answered', 'You allowed: run command git commit (ok)'],
      ['you', 'Add a test'],
      ['event', 'You stopped the hero.'],
      ['event', 'VS Code reloaded; the session stopped.'],
      ['event', 'Error: The session stopped when VS Code reloaded.'],
      ['event', 'You resumed the hero.'],
      ['event', 'Submitted: Fixed the redirect.'],
      ['event', 'The submit check passed.'],
      ['event', 'You finished the quest.'],
      ['event', 'Worktree removed.'],
    ]);
    expect(journal.entries[2]).toEqual({
      t: 500,
      heroId: 'h4',
      kind: 'tool',
      activity: 'test',
      detail: 'pnpm test',
      outcome: 'failed',
    });
    expect(journal.entries[0]?.heroId).toBeNull();
  });

  it('records questions and answers, and returns only the new lines each time', () => {
    const journal = new Journal();
    let state = initialState();
    const feed = (input: Input, t: number) => {
      const record = { ...input, t } as LogRecord;
      state = step(state, record).state;
      return journal.add({ record, state });
    };
    for (const [i, input] of quest.entries()) feed(input, i);
    expect(
      feed(
        {
          kind: 'agent',
          heroId: 'h4',
          event: {
            type: 'question',
            requestId: 'q1',
            questions: [
              {
                question: 'Which database?',
                header: 'DB',
                options: [{ label: 'Postgres', description: '' }],
                multiSelect: false,
              },
            ],
          },
        },
        10,
      ),
    ).toEqual([{ t: 10, heroId: 'h4', kind: 'asked', text: 'Which database?' }]);
    expect(
      feed(
        {
          kind: 'command',
          command: {
            type: 'answerQuestion',
            commandId: 'a',
            itemId: 'n5',
            answers: { 'Which database?': ['Postgres', 'SQLite'] },
          },
        },
        11,
      ),
    ).toEqual([{ t: 11, heroId: 'h4', kind: 'answered', text: 'You answered: Postgres, SQLite' }]);
  });

  it('skips a finish without its start, and inputs with nothing to say', () => {
    const journal = journalOf([
      ...quest,
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityFinished', toolUseId: 'nope', outcome: 'ok' },
      },
      { kind: 'agent', heroId: 'h4', event: { type: 'turnStarted' } },
      { kind: 'gm', event: { type: 'diffObserved', heroId: 'h4', hash: 'x' } },
    ]);
    expect(journal.entries.map((e) => e.kind)).toEqual(['event', 'event']);
  });

  it('words the less common moments too', () => {
    const journal = journalOf([
      ...quest,
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityStarted', toolUseId: 'u1', kind: 'think' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityFinished', toolUseId: 'u1', outcome: 'ok' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: {
          type: 'permission',
          requestId: 'r1',
          tool: 'Bash',
          input: { command: 'rm -rf x' },
        },
      },
      {
        kind: 'command',
        command: { type: 'answerPermission', commandId: 'a1', itemId: 'n5', decision: 'deny' },
      },
      {
        kind: 'command',
        command: { type: 'answerPermission', commandId: 'a2', itemId: 'nope', decision: 'allow' },
      },
      {
        kind: 'command',
        command: { type: 'answerQuestion', commandId: 'a3', itemId: 'nope', answers: { q: 'Yes' } },
      },
      { kind: 'agent', heroId: 'h4', event: { type: 'turnEnded', queuedTurns: 0 } },
      { kind: 'command', command: { type: 'markDone', commandId: 'd1', heroId: 'h4' } },
      {
        kind: 'command',
        command: { type: 'raiseBudget', commandId: 'b1', heroId: 'h4', addMicroUsd: 2_000_000 },
      },
      {
        kind: 'gm',
        event: {
          type: 'submitChecked',
          heroId: 'h4',
          toolUseId: 'u9',
          ok: false,
          reason: 'Uncommitted changes.',
        },
      },
      { kind: 'gm', event: { type: 'submitChecked', heroId: 'h4', toolUseId: 'u9', ok: false } },
      { kind: 'agent', heroId: 'h4', event: { type: 'error', message: 'Overloaded' } },
      { kind: 'command', command: { type: 'abandonQuest', commandId: 'x1' } },
    ]);
    const said = journal.entries.map((e) => ('text' in e ? e.text : `${e.activity} ${e.outcome}`));
    expect(said).toEqual(
      expect.arrayContaining([
        'think ok',
        'Asks to run command: rm -rf x',
        'You denied: run command rm -rf x',
        'You allowed',
        'You answered: Yes',
        'You marked the task done.',
        'You raised the gold pouch.',
        'The submit check failed: Uncommitted changes.',
        'The submit check failed: no reason given',
        'Error: Overloaded',
        'You abandoned the quest.',
      ]),
    );
    expect(journal.entries.find((e) => e.kind === 'tool')).not.toHaveProperty('detail');
  });

  it('notes a failed worktree, a stall and running out of gold', () => {
    const failed = journalOf([
      quest[0] as Input,
      quest[1] as Input,
      { kind: 'gm', event: { type: 'worktreeFailed', islandId: 'i2', message: 'not a repo' } },
    ]);
    expect(failed.entries.slice(-2).map((e) => ('text' in e ? e.text : ''))).toEqual([
      'The worktree failed: not a repo',
      'Error: Could not create the worktree: not a repo',
    ]);

    const stalled = journalOf([
      {
        kind: 'gm',
        event: {
          type: 'questSettings',
          ...DEFAULT_SETTINGS,
          stall: { ...DEFAULT_SETTINGS.stall, testFailures: 1 },
        },
      },
      ...quest.slice(1),
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityStarted', toolUseId: 'u1', kind: 'test', detail: 'pnpm test' },
      },
      {
        kind: 'agent',
        heroId: 'h4',
        event: { type: 'activityFinished', toolUseId: 'u1', outcome: 'failed' },
      },
      { kind: 'agent', heroId: 'h4', event: { type: 'budgetExhausted' } },
    ]);
    const texts = stalled.entries.map((e) => ('text' in e ? e.text : ''));
    expect(texts.some((t) => t.startsWith('Stalled: '))).toBe(true);
  });

  it('pages from the end, or before an index', () => {
    const journal = journalOf(quest);
    expect(journal.page({})).toMatchObject({ start: 0, total: 2 });
    expect(journal.page({ limit: 1 })).toMatchObject({ start: 1, total: 2 });
    expect(journal.page({ before: 1 }).entries).toHaveLength(1);
    expect(journal.page({ before: 99, limit: 5 })).toMatchObject({ start: 0, total: 2 });
  });
});
