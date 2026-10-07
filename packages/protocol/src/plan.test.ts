import { describe, expect, it } from 'vitest';
import { checkPlan, planIslands, taskOrder } from './plan';
import type { Plan, PlanTask } from './plan.schema';

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: id,
  description: `Do ${id}.`,
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
  ...extra,
});
const plan = (extra: Partial<Plan> = {}): Plan => ({
  summary: 'Plan',
  goal: 'Goal',
  tasks: [task('T1')],
  decisions: [],
  ...extra,
});
const decision = (id: string, extra: Partial<Plan['decisions'][number]> = {}) => ({
  id,
  title: id,
  raisedBy: 'elder',
  chosen: 'A',
  alternatives: [],
  why: 'Because',
  affects: [],
  ...extra,
});
const problems = (input: unknown, roster = ['security']) => {
  const r = checkPlan({ input, roster });
  return r.ok ? [] : r.problems;
};

describe('checkPlan (#104)', () => {
  it('accepts a plan whose references all hold', () => {
    const good = plan({
      tasks: [
        task('T1', {
          criteria: [{ councillorId: 'security', items: ['Hashed'] }],
          decisions: ['D1'],
        }),
        task('T2', { dependsOn: ['T1'] }),
      ],
      decisions: [
        decision('D1', { raisedBy: 'security', affects: ['T1'] }),
        decision('D2', { supersedes: 'D1' }),
      ],
    });
    expect(checkPlan({ input: good, roster: ['security'] })).toEqual({ ok: true, plan: good });
  });

  it('names broken references', () => {
    expect(
      problems(
        plan({
          tasks: [
            task('T1', {
              dependsOn: ['T7'],
              decisions: ['D9'],
              criteria: [{ councillorId: 'bard', items: ['x'] }],
            }),
            task('T1'),
          ],
          decisions: [
            decision('D1', { raisedBy: 'bard', affects: ['T5'], supersedes: 'D4' }),
            decision('D1'),
          ],
        }),
      ),
    ).toEqual([
      'Task T1 appears more than once.',
      'Decision D1 appears more than once.',
      "T1 depends on T7, which isn't a task.",
      "T1 refers to D9, which isn't a decision.",
      "T1 has criteria for bard, who isn't on the roster.",
      "D1 was raised by bard, who isn't at the table.",
      "D1 affects T5, which isn't a task.",
      "D1 supersedes D4, which isn't a decision.",
    ]);
  });

  it('refuses tasks that depend on each other in a circle', () => {
    expect(
      problems(
        plan({ tasks: [task('T1', { dependsOn: ['T2'] }), task('T2', { dependsOn: ['T1'] })] }),
      ),
    ).toEqual(['The tasks depend on each other in a circle.']);
  });

  it('gives schema problems with where they are', () => {
    const found = problems({ ...plan(), tasks: [{ ...task('T1'), id: 'task-1' }] });
    expect(found).toEqual(['tasks.0.id: Task ids look like T1, T2, …']);
    expect(problems({ ...plan(), tasks: [] })[0]).toMatch(/^tasks: /);
    expect(problems('no plan').length).toBeGreaterThan(0);
  });
});

describe('taskOrder (#104)', () => {
  it('puts each task after the ones it depends on, otherwise as listed', () => {
    const order = taskOrder([
      task('T3', { dependsOn: ['T2'] }),
      task('T1'),
      task('T2', { dependsOn: ['T1'] }),
    ]);
    expect(order?.map((t) => t.id)).toEqual(['T1', 'T2', 'T3']);
  });
});

describe('islands and branching (#120)', () => {
  const island = (id: string, tasks: string[]) => ({ id, title: id, tasks });
  const three = [task('T1'), task('T2', { dependsOn: ['T1'] }), task('T3')];

  it('reads a plan without islands as one separate island with every task in order', () => {
    expect(planIslands(plan({ tasks: [task('T2', { dependsOn: ['T1'] }), task('T1')] }))).toEqual({
      islands: [{ id: 'I1', title: 'Goal', tasks: ['T1', 'T2'] }],
      branching: 'separate',
    });
  });

  it('accepts islands that hold together, separate by default', () => {
    const good = plan({
      tasks: three,
      islands: [island('I1', ['T1', 'T2']), island('I2', ['T3'])],
    });
    expect(problems(good)).toEqual([]);
    expect(planIslands(good).branching).toBe('separate');
  });

  it('wants every task on exactly one island, and islands that exist', () => {
    expect(
      problems(
        plan({
          tasks: three,
          islands: [island('I1', ['T1', 'T9']), island('I1', ['T1'])],
        }),
      ),
    ).toEqual([
      'Island I1 appears more than once.',
      "I1 has T9, which isn't a task.",
      'T1 is on both I1 and I1.',
      "T2 isn't on any island.",
      "T3 isn't on any island.",
    ]);
    expect(problems(plan({ branching: 'stacked' }))).toEqual([
      'A plan with branching needs islands.',
    ]);
  });

  it("keeps each island's order to its own dependencies", () => {
    expect(problems(plan({ tasks: three, islands: [island('I1', ['T2', 'T1', 'T3'])] }))).toEqual([
      'On I1, T2 comes before T1, which it depends on.',
    ]);
  });

  it('lets a stacked island depend only on itself and the islands before it', () => {
    const later = plan({
      tasks: [task('T1', { dependsOn: ['T2'] }), task('T2')],
      islands: [island('I1', ['T1']), island('I2', ['T2'])],
      branching: 'stacked',
    });
    expect(problems(later)).toEqual(['T1 on I1 depends on T2 on I2, a later island in the stack.']);
    const earlier = plan({
      tasks: [task('T1'), task('T2', { dependsOn: ['T1'] })],
      islands: [island('I1', ['T1']), island('I2', ['T2'])],
      branching: 'stacked',
    });
    expect(problems(earlier)).toEqual([]);
  });

  it('refuses separate islands that wait on each other in a circle', () => {
    const circle = plan({
      tasks: [
        task('T1'),
        task('T2', { dependsOn: ['T1'] }),
        task('T3'),
        task('T4', { dependsOn: ['T3'] }),
      ],
      islands: [island('I1', ['T1', 'T4']), island('I2', ['T3', 'T2'])],
    });
    expect(problems(circle)).toEqual(['The islands wait on each other in a circle.']);
  });

  it('gives schema problems for bad island ids', () => {
    expect(problems(plan({ islands: [{ id: 'one', title: 'x', tasks: ['T1'] }] }))[0]).toBe(
      'islands.0.id: Island ids look like I1, I2, …',
    );
  });
});
