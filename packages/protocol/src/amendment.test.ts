import { describe, expect, it } from 'vitest';
import { amendmentChanges, applyAmendment, checkAmendment } from './amendment';
import type { Amendment } from './amendment.schema';
import type { Plan, PlanTask } from './plan.schema';

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: `Task ${id}`,
  description: `Do ${id}.`,
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
  ...extra,
});
// A plan without islands: one island holding every task, in order.
const PLAN: Plan = {
  summary: 'S',
  goal: 'Sign-in',
  tasks: [task('T1'), task('T2', { dependsOn: ['T1'] }), task('T3')],
  decisions: [],
};
const DECISION = {
  id: 'D1',
  title: 'Cookies',
  raisedBy: 'security',
  chosen: 'httpOnly',
  alternatives: [],
  why: 'XSS',
  affects: ['T4'],
};
const AMENDMENT: Amendment = {
  summary: 'Drop T3, add a frontend',
  tasks: [task('T4', { decisions: ['D1'] })],
  removeTasks: ['T3'],
  addToIslands: [],
  islands: [{ id: 'I2', title: 'Frontend', tasks: ['T4'] }],
  decisions: [DECISION],
};

describe('amendments (#170)', () => {
  it('applies to a plan without islands, giving it its islands', () => {
    expect(applyAmendment({ plan: PLAN, amendment: AMENDMENT })).toMatchObject({
      tasks: [{ id: 'T1' }, { id: 'T2' }, { id: 'T4' }],
      islands: [
        { id: 'I1', title: 'Sign-in', tasks: ['T1', 'T2'] },
        { id: 'I2', title: 'Frontend', tasks: ['T4'] },
      ],
      branching: 'separate',
      decisions: [DECISION],
    });
  });

  it('lists removed tasks, new islands and decisions in the change set', () => {
    expect(amendmentChanges({ plan: PLAN, amendment: AMENDMENT })).toEqual([
      { kind: 'added', taskId: 'T4', title: 'Task T4', island: 'Frontend' },
      { kind: 'removed', taskId: 'T3', title: 'Task T3', island: 'Sign-in' },
      { kind: 'island', islandId: 'I2', title: 'Frontend', tasks: ['T4'] },
      { kind: 'decision', decisionId: 'D1', title: 'Cookies' },
    ]);
  });

  it('checks the amended plan as a whole: a removed task still depended on', () => {
    const checked = checkAmendment({
      input: { ...AMENDMENT, removeTasks: ['T1'] },
      plan: PLAN,
      roster: ['security'],
      started: [],
    });
    expect(checked).toEqual({ ok: false, problems: ["T2 depends on T1, which isn't a task."] });
    expect(
      checkAmendment({ input: AMENDMENT, plan: PLAN, roster: ['security'], started: ['T1'] }),
    ).toMatchObject({ ok: true, amendment: AMENDMENT });
    expect(
      checkAmendment({
        input: { ...AMENDMENT, tasks: [...AMENDMENT.tasks, task('T3')] },
        plan: PLAN,
        roster: [],
        started: [],
      }),
    ).toMatchObject({ ok: false, problems: ['T3 is both edited and removed.'] });
  });
});
