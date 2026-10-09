import type { Plan, PlanTask } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import {
  capFromInput,
  heroNameFor,
  namesProblem,
  partyRows,
  REVIEW_EFFORTS,
  reviewEffortsFor,
} from './parties';

const task = (id: string, extra: Partial<PlanTask> = {}): PlanTask => ({
  id,
  title: `Task ${id}`,
  description: 'x',
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
  ...extra,
});
const plan = (extra: Partial<Plan>): Plan => ({
  summary: 'S',
  goal: 'Goal',
  tasks: [task('T1')],
  decisions: [],
  ...extra,
});

describe('party assembly rows (#123)', () => {
  it("makes one row per island: tasks in order, the first task's class, unique names, its reviewers", () => {
    const rows = partyRows(
      plan({
        tasks: [
          task('T1', {
            heroClass: 'rogue',
            criteria: [{ councillorId: 'security', items: ['a'] }],
          }),
          task('T2', {
            criteria: [
              { councillorId: 'tester', items: ['b'] },
              { councillorId: 'security', items: ['c'] },
            ],
          }),
          task('T3', { heroClass: 'rogue' }),
        ],
        islands: [
          { id: 'I1', title: 'Backend', tasks: ['T1', 'T2'] },
          { id: 'I2', title: 'Docs', tasks: ['T3'] },
        ],
      }),
    );
    expect(rows).toEqual([
      {
        islandId: 'I1',
        title: 'Backend',
        tasks: ['Task T1', 'Task T2'],
        classId: 'rogue',
        heroName: 'Rogue Vex',
        councillors: ['security', 'tester'],
      },
      {
        islandId: 'I2',
        title: 'Docs',
        tasks: ['Task T3'],
        classId: 'rogue',
        heroName: 'Rogue Nim',
        councillors: [],
      },
    ]);
  });

  it('reads a plan without islands as one row, a Ranger by default', () => {
    expect(partyRows(plan({}))).toMatchObject([
      { islandId: 'I1', title: 'Goal', classId: 'ranger', heroName: 'Ranger Ilse' },
    ]);
  });

  it('runs out of names gracefully', () => {
    const taken = ['Rogue Vex', 'Rogue Nim', 'Rogue Sable'];
    expect(heroNameFor({ classId: 'rogue', taken })).toBe('Rogue Vex 2');
    expect(heroNameFor({ classId: 'rogue', taken: [...taken, 'Rogue Vex 2'] })).toBe('Rogue Vex 3');
    expect(heroNameFor({ classId: 'wizard', taken: [] })).toBe('Hero');
  });
});

describe('gold caps and names (#123)', () => {
  it('keeps the default for empty, none for no cap, dollars otherwise', () => {
    expect(capFromInput({ text: '', noCap: false })).toEqual({
      ok: true,
      budgetMicroUsd: undefined,
    });
    expect(capFromInput({ text: '5', noCap: true })).toEqual({ ok: true, budgetMicroUsd: null });
    expect(capFromInput({ text: ' $2.5 ', noCap: false })).toEqual({
      ok: true,
      budgetMicroUsd: 2_500_000,
    });
    expect(capFromInput({ text: 'lots', noCap: false })).toEqual({
      ok: false,
      problem: '"lots" isn\'t an amount of dollars.',
    });
    expect(capFromInput({ text: '0', noCap: false }).ok).toBe(false);
  });

  it('wants every hero named, and no two alike', () => {
    expect(namesProblem(['A', 'B'])).toBeUndefined();
    expect(namesProblem(['A', ' '])).toBe('Every hero needs a name.');
    expect(namesProblem(['A', 'A '])).toBe('Two heroes are called A.');
  });
});

describe('review efforts (#139)', () => {
  it('offers Light, Standard and Deep, Light first', () => {
    expect(REVIEW_EFFORTS.map((e) => e.id)).toEqual(['light', 'standard', 'deep']);
    expect(REVIEW_EFFORTS[0]?.label).toBe('Light: Haiku');
  });

  it('sends one effort per reviewing councillor, Light unless chosen, and none without reviewers', () => {
    expect(
      reviewEffortsFor({
        councillors: ['security', 'tester'],
        chosen: { security: 'deep', tester: 'bogus' },
      }),
    ).toEqual({ reviewEfforts: { security: 'deep', tester: 'light' } });
    expect(reviewEffortsFor({ councillors: ['tester'], chosen: {} })).toEqual({
      reviewEfforts: { tester: 'light' },
    });
    expect(reviewEffortsFor({ councillors: [], chosen: { tester: 'deep' } })).toEqual({});
  });
});
