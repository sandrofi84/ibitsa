import type { Command, Cue, ElderEvent, ElderView, ResearchBrief } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import { Journal } from './journal';
import { initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

const BRIEF: ResearchBrief = {
  task: 'Strip accents in slugify',
  files: [
    { path: 'src/slug.ts', lines: '1-20', note: 'slugify lives here' },
    { path: 'src/slug.test.ts', note: 'its tests' },
  ],
  findings: ['Tests use Vitest.'],
  slices: [{ councillorId: 'tester', summary: 'Add accent cases', pointers: [] }],
  councillors: [{ councillorId: 'tester', reason: 'Behaviour change' }],
  effort: { level: 'light', reason: 'Small change' },
  councillorEfforts: [{ councillorId: 'tester', level: 'light', reason: 'Few cases' }],
  quickQuest: { recommended: true, reason: 'One small function' },
};

/** Feeds commands, elder events and game master events in order, collecting cues and effects. */
class Run {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  readonly journal = new Journal();
  t = 0;
  private n = 0;

  do(command: Record<string, unknown> & { type: Command['type'] }): this {
    return this.feed({
      kind: 'command',
      t: this.t,
      command: { commandId: `c${++this.n}`, ...command } as Command,
    });
  }
  consult(task = 'Strip accents in slugify\nso URLs stay ASCII'): this {
    return this.do({ type: 'consultElder', task });
  }
  elder(event: ElderEvent, elderId = this.view().id): this {
    return this.feed({ kind: 'elder', t: this.t, elderId, event });
  }
  restart(): this {
    return this.feed({ kind: 'gm', t: this.t, event: { type: 'runtimeRestarted' } });
  }
  quickQuest(): this {
    return this.do({
      type: 'startQuest',
      description: 'Strip accents in slugify',
      heroName: 'Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
  }
  worktreeReady(): this {
    const island = view(this.state).islands[0];
    if (!island) throw new Error('no island');
    return this.feed({
      kind: 'gm',
      t: this.t,
      event: { type: 'worktreeCreated', islandId: island.id, path: '/wt', branch: island.branch },
    });
  }
  view(): ElderView {
    const elder = view(this.state).elder;
    if (!elder) throw new Error('no elder');
    return elder;
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
  private feed(input: Parameters<typeof step>[1]): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    this.journal.add({ record: input, state: this.state });
    return this;
  }
}

describe('the elder (spec §4.1, #101)', () => {
  it('starts a planning campaign titled by the task, and the research session', () => {
    const run = new Run().consult();
    expect(view(run.state).campaign).toMatchObject({
      title: 'Strip accents in slugify',
      status: 'planning',
    });
    expect(run.view()).toEqual({
      id: run.view().id,
      task: 'Strip accents in slugify\nso URLs stay ASCII',
      status: 'researching',
      progress: null,
      brief: null,
      gold: { kind: 'unknown' },
      error: null,
    });
    expect(run.effects).toEqual([
      {
        type: 'startElder',
        elderId: run.view().id,
        task: 'Strip accents in slugify\nso URLs stay ASCII',
      },
    ]);
    expect(view(run.state).heroes).toEqual([]);
  });

  it('shows progress and gold while researching, then keeps and saves the brief and closes the session', () => {
    const run = new Run().consult();
    const id = run.view().id;
    run
      .elder({ type: 'sessionStarted', sessionId: 'sess-1' })
      .elder({ type: 'activity', text: 'Reading src/slug.ts' })
      .elder({ type: 'usage', totalCost: 41_000 });
    expect(run.view()).toMatchObject({
      progress: 'Reading src/slug.ts',
      gold: { kind: 'exact', value: 41_000 },
    });
    // The campaign's gold counts the research too.
    expect(view(run.state).campaign?.gold).toEqual({ kind: 'exact', value: 41_000 });
    run.effects = [];
    run.elder({ type: 'briefSubmitted', brief: BRIEF });
    expect(run.view()).toMatchObject({ status: 'briefed', brief: BRIEF, progress: null });
    expect(run.effects).toEqual([
      { type: 'closeElder', elderId: id },
      { type: 'saveBrief', elderId: id, brief: BRIEF },
    ]);
    // Late events change nothing but the cost.
    run.effects = [];
    run.elder({ type: 'activity', text: 'Reading more' }).elder({ type: 'error', message: 'late' });
    expect(run.view()).toMatchObject({ status: 'briefed', progress: null, error: null });
    expect(run.effects).toEqual([]);
  });

  it('fails on an error, keeping the message, and can be asked again in the same campaign', () => {
    const run = new Run().consult();
    const campaignId = view(run.state).campaign?.id;
    run.elder({ type: 'error', message: 'Out of gold before the brief.' });
    expect(run.view()).toMatchObject({ status: 'failed', error: 'Out of gold before the brief.' });
    expect(run.effects.at(-1)).toEqual({ type: 'closeElder', elderId: run.view().id });
    run.consult('Strip accents, and lowercase');
    expect(run.view()).toMatchObject({
      status: 'researching',
      task: 'Strip accents, and lowercase',
    });
    expect(view(run.state).campaign).toMatchObject({
      id: campaignId,
      title: 'Strip accents, and lowercase',
    });
  });

  it('ignores events from another research session', () => {
    const run = new Run().consult();
    run.elder({ type: 'briefSubmitted', brief: BRIEF }, 'e999');
    expect(run.view().status).toBe('researching');
  });

  it('refuses a second consultation while researching, during a quest, or while the council sits', () => {
    const researching = new Run().consult().consult();
    expect(researching.rejections()).toEqual(['The elder is already researching.']);

    const questing = new Run().quickQuest().consult();
    expect(questing.rejections()).toEqual(['Finish or abandon the current quest first.']);

    const sitting = new Run().do({
      type: 'conveneCouncil',
      task: 'Add sign-in',
      mode: 'roundTable',
      roster: ['architect'],
      effort: 'standard',
    });
    sitting.consult();
    expect(sitting.rejections()).toEqual(['The council is sitting.']);
  });

  it('marks research cut short by a reload as failed, so it can be asked again', () => {
    const run = new Run().consult().restart();
    expect(run.view()).toMatchObject({
      status: 'failed',
      error: 'The research stopped when VS Code reloaded. Ask the elder again.',
    });
  });

  it('stops the research when the planning campaign is abandoned', () => {
    const run = new Run().consult();
    run.effects = [];
    run.do({ type: 'abandonQuest' });
    expect(view(run.state).campaign?.status).toBe('abandoned');
    expect(run.view()).toMatchObject({ status: 'failed', error: 'The quest was abandoned.' });
    expect(run.effects).toContainEqual({ type: 'closeElder', elderId: run.view().id });
  });

  it('turns the brief into a quick quest in the same campaign, telling the hero what the elder found', () => {
    const run = new Run().consult();
    const campaignId = view(run.state).campaign?.id;
    expect(run.quickQuest().rejections()).toEqual(['The elder is still researching.']);
    run.elder({ type: 'briefSubmitted', brief: BRIEF }).quickQuest();
    expect(view(run.state).campaign).toMatchObject({ id: campaignId, status: 'active' });
    run.effects = [];
    run.worktreeReady();
    const start = run.effects.find((e) => e.type === 'startSession');
    expect(start?.type === 'startSession' && start.prompt).toBe(
      [
        'Strip accents in slugify',
        '',
        'The elder researched this task first. Start from these and read others only when you need to:',
        '- src/slug.ts:1-20: slugify lives here',
        '- src/slug.test.ts: its tests',
        '',
        'What the elder found:',
        '- Tests use Vitest.',
      ].join('\n'),
    );
  });

  it('starts a quick quest without a briefing when the research failed', () => {
    const run = new Run().consult().elder({ type: 'error', message: 'No brief.' }).quickQuest();
    run.effects = [];
    run.worktreeReady();
    const start = run.effects.find((e) => e.type === 'startSession');
    expect(start?.type === 'startSession' && start.prompt).toBe('Strip accents in slugify');
  });

  it('writes the consultation, the brief and failures into the journal', () => {
    const run = new Run().consult().elder({ type: 'briefSubmitted', brief: BRIEF });
    const failed = new Run().consult().elder({ type: 'error', message: 'Out of gold.' });
    expect(run.journal.entries.map((e) => 'text' in e && e.text)).toEqual([
      'You asked the elder: Strip accents in slugify',
      "The elder's brief is ready.",
    ]);
    expect(failed.journal.entries.at(-1)).toMatchObject({
      text: "The elder couldn't finish: Out of gold.",
    });
  });
});
