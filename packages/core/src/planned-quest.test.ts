import type { Command, Cue, Plan } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import type { CoreInput } from './inputs.types';
import { initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const PLAN: Plan = {
  summary: 'Sign-in in three tasks',
  goal: 'Let users sign in',
  tasks: [
    // Listed out of order: T3 needs T2 first.
    {
      id: 'T3',
      title: 'Tests',
      description: 'Cover sign-in.',
      files: [],
      dependsOn: ['T2'],
      criteria: [{ councillorId: 'tester', items: ['Each behaviour has a test.'] }],
      decisions: [],
    },
    {
      id: 'T1',
      title: 'Auth module',
      description: 'Add the auth module.',
      files: ['src/auth.ts'],
      dependsOn: [],
      criteria: [{ councillorId: 'security', items: ['Passwords are hashed.'] }],
      decisions: ['D1'],
    },
    {
      id: 'T2',
      title: 'Form',
      description: 'Add the form.',
      files: [],
      dependsOn: ['T1'],
      criteria: [],
      decisions: [],
    },
  ],
  decisions: [
    {
      id: 'D1',
      title: 'Sign-in methods',
      raisedBy: 'security',
      chosen: 'Email only',
      alternatives: [{ option: 'Google', rejectedBecause: 'OAuth setup' }],
      why: 'Ship the core first.',
      affects: ['T1'],
    },
  ],
};

class Run {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  private n = 0;
  feed(input: CoreInput): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    return this;
  }
  do(command: Record<string, unknown> & { type: Command['type'] }): this {
    return this.feed({
      kind: 'command',
      t: 0,
      command: { commandId: `c${++this.n}`, ...command } as Command,
    });
  }
  council(event: Extract<CoreInput, { kind: 'council' }>['event']): this {
    return this.feed({ kind: 'council', t: 0, sittingId: this.state.sitting?.id ?? '', event });
  }
  /** Convene, report, propose and approve. */
  approved(): this {
    this.do({
      type: 'conveneCouncil',
      task: 'Add sign-in',
      mode: 'roundTable',
      roster: ['security', 'tester'],
      effort: 'standard',
    });
    const report = { concerns: [], questions: [], recommendations: [], notChecked: [] };
    this.council({ type: 'reportFiled', toolUseId: 'r1', councillorId: 'security', report });
    this.council({ type: 'reportFiled', toolUseId: 'r2', councillorId: 'tester', report });
    this.council({ type: 'planProposed', toolUseId: 'p1', plan: PLAN });
    return this.do({ type: 'approvePlan', version: 1 });
  }
  start(): this {
    return this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: [{ islandId: 'I1', heroName: 'Ilse', classId: 'ranger' }],
    });
  }
  heroId(): string {
    return this.state.heroes[0]?.id ?? '';
  }
  worktreeReady(): this {
    const island = this.state.islands[0];
    return this.feed({
      kind: 'gm',
      t: 0,
      event: {
        type: 'worktreeCreated',
        islandId: island?.id ?? '',
        path: '/wt',
        branch: island?.branch ?? '',
      },
    });
  }
  submitted(toolUseId: string): this {
    this.feed({
      kind: 'agent',
      t: 0,
      heroId: this.heroId(),
      event: { type: 'taskSubmitted', toolUseId, summary: 'Done' },
    });
    return this.feed({
      kind: 'gm',
      t: 0,
      event: { type: 'submitChecked', heroId: this.heroId(), toolUseId, ok: true },
    });
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

describe('carrying out the approved plan (#104)', () => {
  it('needs an approved plan', () => {
    expect(new Run().start().rejections()).toEqual(['There is no approved plan to carry out.']);
  });

  it("makes the plan's tasks the island's task points, in dependency order, the first one active", () => {
    const run = new Run().approved().start();
    const snapshot = view(run.state);
    expect(snapshot.campaign).toMatchObject({ status: 'active', title: 'Add sign-in' });
    expect(snapshot.islands[0]?.taskPoints.map((t) => [t.title, t.state])).toEqual([
      ['Auth module', 'active'],
      ['Form', 'locked'],
      ['Tests', 'locked'],
    ]);
    expect(run.effects.at(-1)).toMatchObject({
      type: 'createWorktree',
      branch: 'ibitsa/add-sign-in',
    });
  });

  it('tells the hero the task, where it sits in the plan, the files, the criteria and the decisions', () => {
    const run = new Run().approved().start().worktreeReady();
    const start = run.effects.find((e) => e.type === 'startSession');
    expect(start?.type === 'startSession' && start.prompt).toBe(
      [
        'Add the auth module.',
        '',
        "This is task 1 of 3 in the council's plan: Let users sign in",
        '',
        'Files likely touched:',
        '- src/auth.ts',
        '',
        'It is done when:',
        '- Passwords are hashed. (security)',
        '',
        'Decisions already taken (keep to them):',
        '- D1 Sign-in methods: Email only. Ship the core first.',
        '',
        'Commit this task, then call submit_task; the next task follows as a message.',
      ].join('\n'),
    );
  });

  it('moves the hero on to each next task as a message, and is submitted after the last', () => {
    const run = new Run().approved().start().worktreeReady();
    run.effects = [];
    run.submitted('s1');
    const points = () => view(run.state).islands[0]?.taskPoints.map((t) => t.state);
    expect(points()).toEqual(['doneUnreviewed', 'active', 'locked']);
    const message = run.effects.find((e) => e.type === 'sendMessage');
    expect(message).toMatchObject({ priority: 'next' });
    expect(message?.type === 'sendMessage' && message.text).toContain(
      'Add the form.\n\nThis is task 2 of 3',
    );
    expect(run.state.heroes[0]?.submitted).toBeNull();
    run.submitted('s2').submitted('s3');
    expect(points()).toEqual(['doneUnreviewed', 'doneUnreviewed', 'doneUnreviewed']);
    expect(run.state.heroes[0]?.submitted).toEqual({ summary: 'Done' });
  });
});
