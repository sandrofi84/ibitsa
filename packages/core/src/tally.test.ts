import type { Command, CouncilEvent, Cue, Plan } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { CoreInput } from './inputs.types';
import { Sitting } from './sitting';
import { initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const PLAN: Plan = {
  summary: 'Plan',
  goal: 'Add sign-in',
  tasks: [
    {
      id: 'T1',
      title: 'Auth',
      description: 'Add auth.',
      files: [],
      dependsOn: [],
      criteria: [{ councillorId: 'security', items: ['Hashed', 'Rate-limited'] }],
      decisions: ['D1'],
    },
  ],
  decisions: [
    {
      id: 'D1',
      title: 'Methods',
      raisedBy: 'security',
      chosen: 'Email',
      alternatives: [],
      why: 'Simple',
      affects: ['T1'],
    },
  ],
};
const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };
const BRIEF = {
  task: 'Add sign-in',
  files: [],
  findings: [],
  slices: [],
  councillors: [
    { councillorId: 'security', reason: 'Sessions' },
    { councillorId: 'tester', reason: 'Behaviour' },
  ],
  effort: { level: 'standard' as const, reason: 'Decisions' },
  councillorEfforts: [
    { councillorId: 'security', level: 'deep' as const, reason: 'Tokens' },
    { councillorId: 'tester', level: 'light' as const, reason: 'Few cases' },
  ],
  quickQuest: { recommended: false, reason: 'Decisions' },
};

class Run {
  state: CoreState = initialState();
  cues: Cue[] = [];
  t = 0;
  private n = 0;
  feed(input: CoreInput): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    return this;
  }
  do(command: Record<string, unknown> & { type: Command['type'] }): this {
    return this.feed({
      kind: 'command',
      t: this.t,
      command: { commandId: `c${++this.n}`, ...command } as Command,
    });
  }
  council(event: CouncilEvent): this {
    return this.feed({
      kind: 'council',
      t: this.t,
      sittingId: this.state.sitting?.id ?? '',
      event,
    });
  }
  briefed(): this {
    this.do({ type: 'consultElder', task: 'Add sign-in' });
    return this.feed({
      kind: 'elder',
      t: 0,
      elderId: this.state.elder?.id ?? '',
      event: { type: 'briefSubmitted', brief: BRIEF },
    });
  }
  convene(extra: Record<string, unknown> = {}): this {
    return this.do({
      type: 'conveneCouncil',
      task: 'Add sign-in',
      mode: 'roundTable',
      roster: ['security', 'tester'],
      effort: 'standard',
      ...extra,
    });
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
}

/** A round table played to an approved plan: reports, a question, "Why?", a revision, cost. */
function played(): Run {
  const run = new Run().briefed();
  run.t = 1_000;
  run.convene();
  run.feed({
    kind: 'gm',
    t: 1_000,
    event: {
      type: 'councilVersionNoted',
      sittingId: run.state.sitting?.id ?? '',
      version: 'v-abc',
    },
  });
  run.council({
    type: 'reportFiled',
    toolUseId: 'r1',
    councillorId: 'security',
    report: {
      ...REPORT,
      concerns: [
        { summary: 'Tokens', severity: 'serious', reason: 'XSS' },
        { summary: 'Logs', severity: 'low', reason: 'Noise' },
      ],
    },
  });
  run.council({
    type: 'reportFiled',
    toolUseId: 'r2',
    councillorId: 'tester',
    report: { ...REPORT, bowOut: 'Nothing' },
  });
  run.council({
    type: 'questionsAsked',
    toolUseId: 'a1',
    questions: [
      {
        councillorId: 'security',
        question: 'Length?',
        options: [{ id: 'd', label: 'Day', tradeoff: 'Safe' }],
        allowFreeText: true,
      },
    ],
  });
  const batch = run.state.sitting?.batches[0];
  run.do({ type: 'askCouncilWhy', batchId: batch?.id, questionId: batch?.items[0]?.id });
  run.do({
    type: 'answerCouncil',
    batchId: batch?.id,
    answers: { [batch?.items[0]?.id ?? '']: { optionId: 'd' } },
  });
  run.council({ type: 'planProposed', toolUseId: 'p1', plan: PLAN });
  run.do({ type: 'requestPlanChange', version: 1, text: 'Smaller' });
  run.council({ type: 'reportFiled', toolUseId: 'r3', councillorId: 'security', report: REPORT });
  run.council({ type: 'planProposed', toolUseId: 'p2', plan: PLAN });
  run.council({
    type: 'usage',
    totalCost: 420_000,
    byModel: [
      {
        model: 'sonnet',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 100,
        cacheWriteTokens: 20,
        costMicroUsd: 420_000,
      },
    ],
  });
  run.t = 61_000;
  run.do({ type: 'approvePlan', version: 2 });
  return run;
}

describe('the tally (spec §4.10, #106)', () => {
  it('counts what a sitting cost and produced', () => {
    const run = played();
    const record = run.state.sitting;
    if (!record) throw new Error('no sitting');
    expect(Sitting.tally(record)).toEqual({
      sittingId: record.id,
      mode: 'roundTable',
      councilVersion: 'v-abc',
      comparisonOf: null,
      outcome: 'approved',
      startedAt: 1_000,
      durationMs: 60_000,
      cost: {
        totalMicroUsd: 420_000,
        byModel: [
          {
            model: 'sonnet',
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 100,
            cacheWriteTokens: 20,
            costMicroUsd: 420_000,
          },
        ],
        byCouncillor: [],
      },
      effort: 'standard',
      elderEffort: 'standard',
      roster: [
        { councillorId: 'security', effort: 'standard', elderEffort: 'deep', recommended: true },
        { councillorId: 'tester', effort: 'standard', elderEffort: 'light', recommended: true },
      ],
      changedElderPicks: false,
      reports: 3,
      bowOuts: 1,
      concerns: 2,
      seriousConcerns: 1,
      questionsAsked: 1,
      whys: 1,
      revisions: 1,
      reconsultations: 1,
      plansProposed: 2,
      planTasks: 1,
      planDecisions: 1,
      planCriteria: 2,
      rating: null,
    });
  });

  it("notes when the user changed the elder's picks, and knows nothing without a brief", () => {
    const changed = new Run().briefed().convene({ roster: ['security'], effort: 'deep' });
    expect(
      Sitting.tally(changed.state.sitting as NonNullable<CoreState['sitting']>).changedElderPicks,
    ).toBe(true);
    const chambers = new Run().briefed().convene({
      mode: 'chambers',
      councillorEfforts: { security: 'deep', tester: 'standard' },
    });
    expect(
      Sitting.tally(chambers.state.sitting as NonNullable<CoreState['sitting']>).changedElderPicks,
    ).toBe(true);
    const plain = new Run().convene();
    const tally = Sitting.tally(plain.state.sitting as NonNullable<CoreState['sitting']>);
    expect(tally).toMatchObject({
      changedElderPicks: null,
      elderEffort: null,
      durationMs: null,
      cost: { totalMicroUsd: null },
    });
  });

  it('takes a rating once the sitting has ended, and only then', () => {
    const early = new Run().convene();
    early.do({ type: 'rateSitting', sittingId: early.state.sitting?.id, score: 4 });
    expect(early.rejections()).toEqual(['Only a sitting that has ended can be rated.']);
    const run = played();
    run.do({
      type: 'rateSitting',
      sittingId: run.state.sitting?.id,
      score: 4,
      note: 'Good questions',
    });
    expect(view(run.state).sitting?.rating).toEqual({ score: 4, note: 'Good questions' });
    run.do({ type: 'rateSitting', sittingId: run.state.sitting?.id, score: 2 });
    expect(view(run.state).sitting?.rating).toEqual({ score: 2 });
    run.do({ type: 'rateSitting', sittingId: 'other', score: 3 });
    expect(run.rejections()).toEqual(['Only a sitting that has ended can be rated.']);
  });

  it('keeps the earlier sitting when the council sits again the other way, marked as a comparison', () => {
    const run = played();
    const first = run.state.sitting?.id;
    run.convene({
      mode: 'chambers',
      councillorEfforts: { security: 'standard', tester: 'standard' },
      comparisonOf: first,
    });
    expect(run.state.pastSittings.map((s) => s.id)).toEqual([first]);
    expect(view(run.state).sitting).toMatchObject({
      mode: 'chambers',
      comparisonOf: first,
      rating: null,
    });
    // A version noted for another sitting changes nothing.
    run.feed({
      kind: 'gm',
      t: 0,
      event: { type: 'councilVersionNoted', sittingId: first ?? '', version: 'x' },
    });
    expect(run.state.sitting?.councilVersion).toBeNull();
  });

  it('keeps tokens per councillor from separate chambers', () => {
    const run = new Run().convene({
      mode: 'chambers',
      councillorEfforts: { security: 'light', tester: 'light' },
    });
    run.council({
      type: 'usage',
      totalCost: 1,
      byCouncillor: [{ councillorId: 'security', tokens: 900 }],
    });
    expect(
      Sitting.tally(run.state.sitting as NonNullable<CoreState['sitting']>).cost.byCouncillor,
    ).toEqual([{ councillorId: 'security', tokens: 900 }]);
  });
});
