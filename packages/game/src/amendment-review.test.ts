import type { Plan, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { changeLines, pendingAmendment } from './amendment-review';
import { amendedPlan } from './party-assembly';

const task = (id: string) => ({
  id,
  title: `Task ${id}`,
  description: `Do ${id}.`,
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
});
const PLAN: Plan = { summary: 'S', goal: 'G', tasks: [task('T1')], decisions: [] };
const AMENDMENT = {
  summary: 'Add T2',
  tasks: [task('T2')],
  removeTasks: [],
  addToIslands: [{ islandId: 'I1', tasks: ['T2'] }],
  islands: [],
  decisions: [],
};
const snapshot = (amendments: unknown[]) =>
  ({
    sitting: {
      plans: [{ version: 1, plan: PLAN, outcome: { kind: 'approved' } }],
      amendments,
    },
  }) as unknown as Snapshot;

describe('the amendment review (#170)', () => {
  it('words each change with a mark', () => {
    expect(
      changeLines([
        { kind: 'added', taskId: 'T3', title: 'Logout', island: 'Backend' },
        { kind: 'edited', taskId: 'T2', title: 'Check', before: 'Task T2', island: 'Backend' },
        { kind: 'edited', taskId: 'T4', title: 'Same', before: 'Same', island: 'Backend' },
        { kind: 'removed', taskId: 'T5', title: 'Old', island: 'Backend' },
        { kind: 'island', islandId: 'I2', title: 'Docs', tasks: ['T6'] },
        { kind: 'decision', decisionId: 'D2', title: 'Cookies' },
      ]),
    ).toEqual([
      { kind: 'added', mark: '+', text: 'Add T3 Logout (Backend)' },
      { kind: 'edited', mark: '~', text: 'Change T2 Task T2 → Check (Backend)' },
      { kind: 'edited', mark: '~', text: 'Change T4 Same (Backend)' },
      { kind: 'removed', mark: '−', text: 'Remove T5 Old (Backend)' },
      { kind: 'added', mark: '+', text: 'New island I2 Docs: T6' },
      { kind: 'added', mark: '+', text: 'Decision D2 Cookies' },
    ]);
  });

  it('finds the amendment waiting, and the plan with the approved ones applied', () => {
    const waiting = { number: 2, amendment: AMENDMENT, changes: [], outcome: { kind: 'proposed' } };
    expect(pendingAmendment(snapshot([waiting]))?.number).toBe(2);
    expect(pendingAmendment(snapshot([]))).toBeNull();
    expect(pendingAmendment(null)).toBeNull();
    const approved = { ...waiting, number: 1, outcome: { kind: 'approved' } };
    expect(amendedPlan(snapshot([approved, waiting]))?.tasks.map((t) => t.id)).toEqual([
      'T1',
      'T2',
    ]);
    expect(amendedPlan({ sitting: null } as unknown as Snapshot)).toBeUndefined();
  });
});
