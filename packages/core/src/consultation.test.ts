import type { Command, CouncilEvent, Cue, Plan, PlanTask } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import type { CoreInput } from './inputs.types';
import { DEFAULT_SETTINGS, initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const task = (id: string): PlanTask => ({
  id,
  title: `Task ${id}`,
  description: `Do ${id}.`,
  files: [],
  dependsOn: [],
  criteria: [],
  decisions: [],
});
const REPORT = { concerns: [], questions: [], recommendations: [], notChecked: [] };
const PLAN: Plan = { summary: 'Sign-in', goal: 'Sign-in', tasks: [task('T1')], decisions: [] };

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
  council(event: CouncilEvent): this {
    return this.feed({ kind: 'council', t: 0, sittingId: this.state.sitting?.id ?? '', event });
  }
  /** Convened with security, its plan approved and the campaign started. */
  started(): this {
    this.feed({ kind: 'gm', t: 0, event: { type: 'questSettings', ...DEFAULT_SETTINGS } });
    this.do({
      type: 'conveneCouncil',
      task: 'Sign-in',
      mode: 'roundTable',
      roster: ['security'],
      effort: 'standard',
    });
    this.council({ type: 'sessionStarted', sessionId: 'lead-1' });
    this.council({ type: 'reportFiled', toolUseId: 'r', councillorId: 'security', report: REPORT });
    this.council({ type: 'planProposed', toolUseId: 'p', plan: PLAN });
    this.do({ type: 'approvePlan', version: 1 });
    this.do({
      type: 'startCampaign',
      baseRef: 'main',
      parties: [{ islandId: 'I1', heroName: 'Ilse', classId: 'ranger' }],
    });
    this.effects = [];
    return this;
  }
  last<T extends Effect['type']>(type: T): Extract<Effect, { type: T }> | undefined {
    return this.effects.filter((e): e is Extract<Effect, { type: T }> => e.type === type).at(-1);
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
  sitting() {
    const sitting = view(this.state).sitting;
    if (!sitting) throw new Error('no sitting');
    return sitting;
  }
}

describe('talking to the council mid-campaign (spec §4.8, #169)', () => {
  it("resumes the lead session with the question and the campaign's status, capped", () => {
    const run = new Run().started();
    run.do({
      type: 'consultCouncil',
      text: 'Should we add rate limiting?',
      councillorId: 'security',
    });
    const effect = run.last('startSitting');
    expect(effect).toMatchObject({
      sittingId: run.state.sitting?.id,
      mode: 'roundTable',
      roster: [{ councillorId: 'security', effort: 'standard' }],
      maxBudgetMicroUsd: 500_000,
      resume: { sessionId: 'lead-1' },
    });
    const prompt = effect?.resume?.prompt ?? '';
    expect(prompt).toContain('The plan is approved and the heroes are at work.');
    expect(prompt).toContain('The user asks security, who answers in its own voice');
    expect(prompt).toContain('Should we add rate limiting?');
    expect(prompt).toContain('- Sign-in (ibitsa/sign-in)\n  - Task T1: active');
    expect(prompt).toContain('- Ilse on Sign-in: traveling');
    expect(prompt).toContain('Waiting on the user: nothing');
    expect(run.sitting().dialogue.at(-1)).toMatchObject({
      speaker: 'you',
      text: '@security Should we add rate limiting?',
    });
    expect(run.sitting().consultations).toEqual([
      {
        id: expect.any(String),
        councillorId: 'security',
        status: 'asking',
        error: null,
        gold: { kind: 'unknown' },
      },
    ]);
  });

  it('turns replies into dialogue, ends on the usage, and counts it toward the gold', () => {
    const run = new Run().started();
    run.do({ type: 'consultCouncil', text: 'Anything worrying?' });
    expect(run.last('startSitting')?.resume?.prompt).toContain(
      'The user asks the council (whoever it concerns answers',
    );
    run.council({ type: 'said', councillorId: 'security', text: 'The session cookie, still.' });
    run.council({ type: 'said', councillorId: 'elder', text: 'Otherwise, on track.' });
    run.council({ type: 'said', councillorId: 'stranger', text: 'Hello' });
    run.council({ type: 'reportFiled', toolUseId: 'x', councillorId: 'security', report: REPORT });
    expect(run.last('completeSittingTool')).toMatchObject({
      toolUseId: 'x',
      accepted: false,
      reason: 'The plan is approved and under way: answer the user with say.',
    });
    run.council({ type: 'usage', totalCost: 120_000 });
    expect(
      run
        .sitting()
        .dialogue.slice(-2)
        .map((d) => [d.speaker, d.text]),
    ).toEqual([
      ['security', 'The session cookie, still.'],
      ['elder', 'Otherwise, on track.'],
    ]);
    expect(run.sitting().consultations[0]).toMatchObject({
      status: 'answered',
      gold: { kind: 'exact', value: 120_000 },
    });
    expect(run.last('closeSitting')).toEqual({
      type: 'closeSitting',
      sittingId: run.state.sitting?.id,
    });
    // The campaign's gold counts it once the hero has reported its own.
    run.feed({
      kind: 'agent',
      t: 0,
      heroId: run.state.heroes[0]?.id ?? '',
      event: { type: 'usage', totalCost: 10_000 },
    });
    expect(view(run.state).campaign?.gold).toMatchObject({ value: 130_000 });
    // A reply after the answer is ignored, and a stray tool call is refused.
    run.council({ type: 'said', councillorId: 'security', text: 'Late' });
    expect(run.sitting().dialogue.at(-1)?.text).toBe('Otherwise, on track.');
  });

  it('asks one question at a time, only of the council that sat, and only mid-campaign', () => {
    const fresh = new Run();
    fresh.do({ type: 'consultCouncil', text: 'Hi' });
    const run = new Run().started();
    run.do({ type: 'consultCouncil', text: 'Hi', councillorId: 'tester' });
    run.do({ type: 'consultCouncil', text: 'One' });
    run.do({ type: 'consultCouncil', text: 'Two' });
    expect([...fresh.rejections(), ...run.rejections()]).toEqual([
      'The council can be asked once its plan is under way.',
      "tester isn't on this council.",
      'The council is still answering the last question.',
    ]);
  });

  it('a failed answer, a reload or the end of the quest drops the question', () => {
    const failed = new Run().started();
    failed.do({ type: 'consultCouncil', text: 'One' });
    failed.council({ type: 'error', message: 'Out of gold' });
    expect(failed.sitting().consultations[0]).toMatchObject({
      status: 'failed',
      error: 'Out of gold',
    });
    failed.do({ type: 'consultCouncil', text: 'Two' });
    expect(failed.last('startSitting')).toBeDefined();

    const reloaded = new Run().started();
    reloaded.do({ type: 'consultCouncil', text: 'One' });
    reloaded.feed({ kind: 'gm', t: 0, event: { type: 'runtimeRestarted' } });
    expect(reloaded.sitting().consultations[0]).toMatchObject({
      status: 'failed',
      error: 'VS Code reloaded before the council answered. Ask again.',
    });

    const ended = new Run().started();
    ended.do({ type: 'consultCouncil', text: 'One' });
    ended.do({ type: 'abandonQuest' });
    expect(ended.sitting().consultations[0]).toMatchObject({
      status: 'failed',
      error: 'The quest ended.',
    });
  });

  it('reports open blocking findings, PRs and what waits on the user in the status', () => {
    const run = new Run().started();
    const island = run.state.islands[0];
    const tp = island?.taskPoints[0];
    if (!island || !tp) throw new Error('no task');
    island.remote = {
      pushedHead: 'a',
      busy: null,
      error: null,
      pullRequest: { number: 3, url: 'u', state: 'draft', base: 'main' },
    };
    tp.state = 'active';
    tp.review = {
      round: 1,
      phase: 'changes',
      checks: [],
      suggestions: [],
      summary: 'Done',
      reviews: [
        {
          id: 'r1',
          councillorId: 'security',
          effort: 'light',
          round: 1,
          status: 'done',
          verdict: {
            verdict: 'changes',
            findings: [{ severity: 'blocking', kind: 'security', message: 'Escape it' }],
          },
          error: null,
          gold: { kind: 'unknown' },
          head: null,
          waived: false,
        },
      ],
    };
    run.do({ type: 'consultCouncil', text: 'Status?' });
    const prompt = run.last('startSitting')?.resume?.prompt ?? '';
    expect(prompt).toContain('- Sign-in (ibitsa/sign-in), PR #3 draft');
    expect(prompt).toContain('  - Task T1: active; blocking from security: Escape it');
  });
});
