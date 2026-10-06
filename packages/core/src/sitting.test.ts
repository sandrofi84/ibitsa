import type {
  Command,
  CouncilEvent,
  CouncilQuestion,
  CouncilReport,
  Cue,
  SittingView,
} from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import type { Effect } from './effects.types';
import { initialState } from './state';
import type { CoreState } from './state.types';
import { step } from './step';
import { view } from './view';

/** Feeds commands and council events in order, collecting cues and effects. */
class Council {
  state: CoreState = initialState();
  cues: Cue[] = [];
  effects: Effect[] = [];
  t = 0;
  private n = 0;

  command(command: Command): this {
    return this.feed({ kind: 'command', t: this.t, command });
  }
  event(event: CouncilEvent, sittingId = this.sitting().id): this {
    return this.feed({ kind: 'council', t: this.t, sittingId, event });
  }
  /** A command with a fresh id. */
  do(command: Record<string, unknown> & { type: Command['type'] }): this {
    return this.command({ commandId: `c${++this.n}`, ...command } as Command);
  }
  convene(extra: Partial<Extract<Command, { type: 'conveneCouncil' }>> = {}): this {
    return this.do({
      type: 'conveneCouncil',
      task: 'Add sign-in',
      mode: 'roundTable',
      roster: ['architect', 'security'],
      effort: 'standard',
      ...extra,
    });
  }
  report(councillorId: string, report: Partial<CouncilReport> = {}): this {
    return this.event({
      type: 'reportFiled',
      toolUseId: `u${++this.n}`,
      councillorId,
      report: { ...REPORT, ...report },
    });
  }
  propose(summary = 'Plan'): this {
    return this.event({ type: 'planProposed', toolUseId: `u${++this.n}`, plan: { summary } });
  }
  sitting(): SittingView {
    const sitting = view(this.state).sitting;
    if (!sitting) throw new Error('no sitting');
    return sitting;
  }
  rejections(): string[] {
    return this.cues.flatMap((c) => (c.type === 'commandRejected' ? [c.reason] : []));
  }
  /** The last tool result core sent the session. */
  lastTool(): Extract<Effect, { type: 'completeSittingTool' }> | undefined {
    return this.effects.filter((e) => e.type === 'completeSittingTool').at(-1) as
      | Extract<Effect, { type: 'completeSittingTool' }>
      | undefined;
  }
  private feed(input: Parameters<typeof step>[1]): this {
    const result = step(this.state, input);
    this.state = result.state;
    this.cues.push(...result.cues);
    this.effects.push(...result.effects);
    return this;
  }
}

const REPORT: CouncilReport = {
  concerns: [{ summary: 'Tokens in localStorage', severity: 'high', reason: 'XSS can read them' }],
  questions: ['Which sign-in methods?'],
  recommendations: ['Use httpOnly cookies'],
  notChecked: [],
};

/** A question to architect; pass `recommendation: undefined` for one without. */
const question = (
  q: Partial<Omit<CouncilQuestion, 'recommendation'>> & {
    recommendation?: CouncilQuestion['recommendation'] | undefined;
  } = {},
): CouncilQuestion => {
  const { recommendation, ...rest } = {
    recommendation: { optionId: 'email', reason: 'Smallest change' },
    ...q,
  };
  return {
    councillorId: 'architect',
    question: 'Which sign-in methods?',
    options: [
      { id: 'email', label: 'Email only', tradeoff: 'Simple' },
      { id: 'google', label: 'Email + Google', tradeoff: 'OAuth setup' },
    ],
    allowFreeText: true,
    ...rest,
    ...(recommendation && { recommendation }),
  };
};

/** Convened, started, everyone reported. */
const deliberating = () =>
  new Council()
    .convene()
    .event({ type: 'sessionStarted', sessionId: 's-1' }, 's1')
    .report('architect')
    .report('security');

describe('convening', () => {
  it('fixes the roster and starts the lead session with each councillor’s effort', () => {
    const c = new Council().convene({
      mode: 'chambers',
      councillorEfforts: { architect: 'light', security: 'deep' },
    });
    expect(c.sitting()).toMatchObject({
      id: 's1',
      status: 'convening',
      mode: 'chambers',
      roster: [
        { councillorId: 'architect', effort: 'light', reported: false },
        { councillorId: 'security', effort: 'deep', reported: false },
      ],
    });
    expect(c.effects).toEqual([
      {
        type: 'startSitting',
        sittingId: 's1',
        mode: 'chambers',
        task: 'Add sign-in',
        effort: 'standard',
        roster: [
          { councillorId: 'architect', effort: 'light' },
          { councillorId: 'security', effort: 'deep' },
        ],
      },
    ]);
    c.event({ type: 'sessionStarted', sessionId: 's-1' });
    expect(c.sitting().status).toBe('deliberating');
  });

  it('gives a round table’s councillors the sitting’s effort', () => {
    const c = new Council().convene();
    expect(c.sitting().roster.map((r) => r.effort)).toEqual(['standard', 'standard']);
  });

  it.each([
    {
      name: 'a councillor twice',
      extra: { roster: ['architect', 'architect'] },
      reason: 'architect is on the roster twice.',
    },
    {
      name: 'an effort for someone not on the roster',
      extra: { councillorEfforts: { tester: 'light' as const } },
      reason: "tester has an effort but isn't on the roster.",
    },
    {
      name: 'separate chambers without every effort',
      extra: { mode: 'chambers' as const, councillorEfforts: { architect: 'light' as const } },
      reason: 'Set an effort for security.',
    },
  ])('refuses $name', ({ extra, reason }) => {
    const c = new Council().convene(extra);
    expect(c.rejections()).toEqual([reason]);
    expect(view(c.state).sitting).toBeNull();
    expect(c.effects).toEqual([]);
  });

  it('refuses while the council is sitting or a quest is running', () => {
    const c = new Council().convene().convene();
    expect(c.rejections()).toEqual(['The council is already sitting.']);
    const q = new Council().do({
      type: 'startQuest',
      description: 'Fix it',
      heroName: 'Ilse',
      classId: 'ranger',
      baseRef: 'main',
    });
    q.convene();
    expect(q.rejections()).toEqual(['Finish or abandon the current quest first.']);
  });

  it('can convene again once the last sitting ended', () => {
    const c = new Council().convene().do({ type: 'dismissCouncil' }).convene();
    expect(c.rejections()).toEqual([]);
    expect(c.sitting()).toMatchObject({ id: 's2', status: 'convening', reports: [] });
  });
});

describe('reports', () => {
  it('files a report under its councillor and accepts the tool call', () => {
    const c = new Council().convene().report('security', { bowOut: 'Nothing in my field.' });
    expect(c.sitting().reports).toEqual([
      {
        id: 'r2',
        councillorId: 'security',
        revision: 0,
        report: { ...REPORT, bowOut: 'Nothing in my field.' },
      },
    ]);
    expect(c.sitting().roster.find((r) => r.councillorId === 'security')?.reported).toBe(true);
    expect(c.lastTool()).toEqual({
      type: 'completeSittingTool',
      sittingId: 's1',
      toolUseId: 'u2',
      accepted: true,
    });
  });

  it('rejects a report from a councillor not on the roster', () => {
    const c = new Council().convene().report('tester');
    expect(c.sitting().reports).toEqual([]);
    expect(c.lastTool()).toMatchObject({
      accepted: false,
      reason: "tester isn't on the council's roster.",
    });
  });
});

describe('questions', () => {
  it('opens a batch with ids, and answers go back to the session in question order', () => {
    const c = deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [
        question(),
        question({
          councillorId: 'security',
          question: 'Session length?',
          options: [],
          recommendation: undefined,
        }),
      ],
    });
    const batch = c.sitting().questions;
    expect(batch).toMatchObject({
      batchId: 'b4',
      items: [{ id: 'q5' }, { id: 'q6', councillorId: 'security' }],
    });
    c.do({
      type: 'answerCouncil',
      batchId: 'b4',
      answers: { q6: { text: 'A week' }, q5: { optionId: 'email' } },
    });
    expect(c.rejections()).toEqual([]);
    expect(c.effects.at(-1)).toEqual({
      type: 'answerSittingQuestions',
      sittingId: 's1',
      toolUseId: 'ask1',
      answers: [{ optionId: 'email' }, { text: 'A week' }],
    });
    expect(c.sitting().questions).toBeNull();
  });

  it.each([
    {
      name: 'a councillor not on the roster',
      bad: question({ councillorId: 'tester' }),
      reason: "tester isn't on the council's roster.",
    },
    {
      name: 'a report by someone else',
      bad: question({ reportId: 'r3' }),
      reason: 'r3 is not a report by architect.',
    },
    {
      name: 'an unknown report',
      bad: question({ reportId: 'r99' }),
      reason: 'r99 is not a report by architect.',
    },
    {
      name: 'no options and no free text',
      bad: question({ options: [], recommendation: undefined, allowFreeText: false }),
      reason: '"Which sign-in methods?" needs options or free text.',
    },
    {
      name: 'a recommendation that is not an option',
      bad: question({ recommendation: { optionId: 'saml', reason: 'Enterprise' } }),
      reason: '"Which sign-in methods?" recommends saml, which isn\'t one of its options.',
    },
  ])('rejects the whole batch for $name', ({ bad, reason }) => {
    // r3 is security's report in `deliberating()`.
    const c = deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [question(), bad],
    });
    expect(c.sitting().questions).toBeNull();
    expect(c.lastTool()).toEqual({
      type: 'completeSittingTool',
      sittingId: 's1',
      toolUseId: 'ask1',
      accepted: false,
      reason,
    });
  });

  it('accepts a question citing the councillor’s own report', () => {
    const c = deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [question({ councillorId: 'security', reportId: 'r3' })],
    });
    expect(c.sitting().questions?.items[0]?.reportId).toBe('r3');
  });

  it('rejects an empty batch, and a second batch while one is open', () => {
    const c = deliberating().event({ type: 'questionsAsked', toolUseId: 'ask0', questions: [] });
    expect(c.lastTool()).toMatchObject({ accepted: false, reason: 'Ask at least one question.' });
    c.event({ type: 'questionsAsked', toolUseId: 'ask1', questions: [question()] });
    c.event({ type: 'questionsAsked', toolUseId: 'ask2', questions: [question()] });
    expect(c.lastTool()).toMatchObject({
      toolUseId: 'ask2',
      accepted: false,
      reason: 'Wait for the answers to the open questions first.',
    });
  });

  it.each([
    {
      name: 'the wrong batch',
      answer: { batchId: 'b9', answers: { q5: { optionId: 'email' } } },
      reason: 'Those questions are no longer open.',
    },
    {
      name: 'a missing answer',
      answer: { batchId: 'b4', answers: {} },
      reason: '"Which sign-in methods?" has no answer.',
    },
    {
      name: 'an unknown option',
      answer: { batchId: 'b4', answers: { q5: { optionId: 'saml' } } },
      reason: '"Which sign-in methods?" has no option saml.',
    },
  ])('refuses answers with $name', ({ answer, reason }) => {
    const c = deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [question()],
    });
    c.do({ type: 'answerCouncil', ...answer });
    expect(c.rejections()).toEqual([reason]);
    expect(c.sitting().questions).not.toBeNull();
  });

  it('refuses free text where only options are allowed', () => {
    const c = deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [question({ allowFreeText: false })],
    });
    c.do({ type: 'answerCouncil', batchId: 'b4', answers: { q5: { text: 'Passkeys' } } });
    expect(c.rejections()).toEqual(['"Which sign-in methods?" needs one of its options.']);
  });
});

describe('proposing a plan', () => {
  it('is rejected until every councillor on the roster has reported', () => {
    const c = new Council().convene().report('architect').propose();
    expect(c.lastTool()).toMatchObject({
      accepted: false,
      reason: 'Every councillor must report before a plan is proposed. Waiting for: security.',
    });
    expect(c.sitting()).toMatchObject({ status: 'convening', plans: [] });
    c.report('security').propose();
    expect(c.lastTool()).toMatchObject({ accepted: true });
    expect(c.sitting()).toMatchObject({
      status: 'awaitingApproval',
      plans: [{ version: 1, plan: { summary: 'Plan' }, outcome: { kind: 'proposed' } }],
    });
  });

  it('is rejected while another plan is waiting', () => {
    const c = deliberating().propose().propose('Again');
    expect(c.lastTool()).toMatchObject({
      accepted: false,
      reason: 'A plan is already waiting for the user.',
    });
    expect(c.sitting().plans).toHaveLength(1);
  });

  it('counts a councillor added mid-sitting: it must report too', () => {
    const c = deliberating().do({ type: 'addCouncillor', councillorId: 'tester', effort: 'light' });
    expect(c.effects.at(-1)).toEqual({
      type: 'sittingMessage',
      sittingId: 's1',
      message: { kind: 'councillorAdded', councillorId: 'tester', effort: 'light' },
    });
    c.propose();
    expect(c.lastTool()).toMatchObject({
      accepted: false,
      reason: expect.stringContaining('Waiting for: tester.'),
    });
    c.report('tester').propose();
    expect(c.sitting().status).toBe('awaitingApproval');
  });

  it('refuses adding a councillor twice, or while a plan is waiting', () => {
    const c = deliberating().do({
      type: 'addCouncillor',
      councillorId: 'security',
      effort: 'light',
    });
    c.propose().do({ type: 'addCouncillor', councillorId: 'tester', effort: 'light' });
    expect(c.rejections()).toEqual([
      'security is already on the roster.',
      'A plan is waiting: ask for changes to add a councillor.',
    ]);
  });
});

describe('approval', () => {
  it('approves the current plan and closes the sitting', () => {
    const c = deliberating();
    c.t = 9_000;
    c.propose().do({ type: 'approvePlan', version: 1 });
    expect(c.sitting()).toMatchObject({
      status: 'approved',
      plans: [{ outcome: { kind: 'approved' } }],
    });
    expect(c.state.sitting?.endedAt).toBe(9_000);
    expect(c.effects.at(-1)).toEqual({ type: 'closeSitting', sittingId: 's1' });
  });

  it('a change request sends the council back and records re-consultations', () => {
    const c = deliberating()
      .propose()
      .do({ type: 'requestPlanChange', version: 1, text: 'No Google sign-in' });
    expect(c.effects.at(-1)).toEqual({
      type: 'sittingMessage',
      sittingId: 's1',
      message: { kind: 'changeRequested', version: 1, text: 'No Google sign-in' },
    });
    expect(c.sitting()).toMatchObject({ status: 'deliberating', revision: 1 });
    c.report('security').propose('Plan v2').do({ type: 'approvePlan', version: 2 });
    expect(c.sitting()).toMatchObject({
      status: 'approved',
      reconsultations: [{ councillorId: 'security', revision: 1, reportId: 'r4' }],
      plans: [
        { version: 1, outcome: { kind: 'changeRequested', text: 'No Google sign-in' } },
        { version: 2, plan: { summary: 'Plan v2' }, outcome: { kind: 'approved' } },
      ],
    });
  });

  it('a councillor’s first report after a change is not a re-consultation', () => {
    const c = deliberating()
      .propose()
      .do({ type: 'requestPlanChange', version: 1, text: 'Add tests' })
      .do({ type: 'addCouncillor', councillorId: 'tester', effort: 'light' })
      .report('tester');
    expect(c.sitting().reconsultations).toEqual([]);
  });

  it('refuses approval when no plan is waiting, and changes to an old version', () => {
    const c = deliberating().do({ type: 'approvePlan', version: 1 });
    c.propose().do({ type: 'requestPlanChange', version: 2, text: 'x' });
    expect(c.rejections()).toEqual([
      'No plan is waiting for approval.',
      'Plan v2 is not the current plan (v1).',
    ]);
  });

  it('dismissing ends the sitting and marks a waiting plan dismissed', () => {
    const c = deliberating().propose().do({ type: 'dismissCouncil' });
    expect(c.sitting()).toMatchObject({
      status: 'dismissed',
      plans: [{ outcome: { kind: 'dismissed' } }],
    });
    expect(c.effects.at(-1)).toEqual({ type: 'closeSitting', sittingId: 's1' });
  });
});

describe('after the sitting', () => {
  it('refuses commands, rejects tool calls and hides open questions', () => {
    const c = deliberating()
      .event({ type: 'questionsAsked', toolUseId: 'ask1', questions: [question()] })
      .do({ type: 'dismissCouncil' });
    expect(c.sitting().questions).toBeNull();
    c.do({ type: 'answerCouncil', batchId: 'b4', answers: { q5: { optionId: 'email' } } });
    c.do({ type: 'dismissCouncil' });
    c.do({ type: 'addCouncillor', councillorId: 'tester', effort: 'light' });
    expect(c.rejections()).toEqual(Array(3).fill('The council is not sitting.'));
    c.report('architect');
    expect(c.lastTool()).toMatchObject({ accepted: false, reason: 'The sitting has ended.' });
    c.event({ type: 'usage', totalCost: 5 });
    expect(c.sitting().gold).toEqual({ kind: 'unknown' });
  });

  it('ignores events from another sitting', () => {
    const c = deliberating();
    const before = c.state;
    c.event({ type: 'error', message: 'boom' }, 's0');
    expect(c.state).toEqual(before);
  });

  it('an error fails the sitting and closes the session', () => {
    const c = deliberating().event({ type: 'error', message: 'API down' });
    expect(c.sitting()).toMatchObject({ status: 'failed', error: 'API down' });
    expect(c.effects.at(-1)).toEqual({ type: 'closeSitting', sittingId: 's1' });
  });

  it('keeps the running cost', () => {
    const c = deliberating().event({ type: 'usage', totalCost: 120_000 });
    expect(c.sitting().gold).toEqual({ kind: 'exact', value: 120_000 });
  });
});

describe('"Why?" (§4.4, #102)', () => {
  const asked = () =>
    deliberating().event({
      type: 'questionsAsked',
      toolUseId: 'ask1',
      questions: [question(), question({ councillorId: 'security', question: 'Session length?' })],
    });

  it('asks the councillor who asked to explain, and records the user asking', () => {
    const c = asked().do({ type: 'askCouncilWhy', batchId: 'b4', questionId: 'q6' });
    expect(c.rejections()).toEqual([]);
    expect(c.effects.at(-1)).toEqual({
      type: 'sittingMessage',
      sittingId: 's1',
      message: {
        kind: 'why',
        questionId: 'q6',
        councillorId: 'security',
        question: 'Session length?',
      },
    });
    expect(c.sitting().dialogue).toEqual([
      { id: 'd1', speaker: 'you', text: 'Why?', questionId: 'q6' },
    ]);
    // Asking doesn't touch the batch: the question stays open with the same ids.
    expect(c.sitting().questions?.items.map((q) => q.id)).toEqual(['q5', 'q6']);
  });

  it('passes on a follow-up in the user’s words', () => {
    const c = asked().do({
      type: 'askCouncilWhy',
      batchId: 'b4',
      questionId: 'q5',
      text: 'Why not Google?',
    });
    expect(c.effects.at(-1)).toMatchObject({
      message: { kind: 'why', councillorId: 'architect', text: 'Why not Google?' },
    });
    expect(c.sitting().dialogue.at(-1)).toMatchObject({ speaker: 'you', text: 'Why not Google?' });
  });

  it('refuses a question that is not open, or with no sitting', () => {
    const c = asked();
    c.do({ type: 'askCouncilWhy', batchId: 'b4', questionId: 'q9' });
    c.do({ type: 'askCouncilWhy', batchId: 'b0', questionId: 'q5' });
    c.do({
      type: 'answerCouncil',
      batchId: 'b4',
      answers: { q5: { optionId: 'email' }, q6: { text: 'A week' } },
    });
    c.do({ type: 'askCouncilWhy', batchId: 'b4', questionId: 'q5' });
    expect(c.rejections()).toEqual([
      'That question is no longer open.',
      'That question is no longer open.',
      'That question is no longer open.',
    ]);
    const none = new Council().do({ type: 'askCouncilWhy', batchId: 'b1', questionId: 'q1' });
    expect(none.rejections()).toEqual(['The council is not sitting.']);
    expect(c.sitting().dialogue).toEqual([]);
  });

  it('records what councillors and the elder say, and drops speakers not at the table', () => {
    const c = asked()
      .do({ type: 'askCouncilWhy', batchId: 'b4', questionId: 'q6' })
      .event({
        type: 'said',
        councillorId: 'security',
        text: 'A long session is a stolen session.',
        questionId: 'q6',
      })
      .event({ type: 'said', councillorId: 'architect', text: 'Refresh tokens help.' })
      .event({ type: 'said', councillorId: 'elder', text: 'Let us decide.' })
      .event({ type: 'said', councillorId: 'stranger', text: 'Psst.' });
    expect(c.sitting().dialogue.map((l) => [l.id, l.speaker, l.questionId])).toEqual([
      ['d1', 'you', 'q6'],
      ['d2', 'security', 'q6'],
      ['d3', 'architect', undefined],
      ['d4', 'elder', undefined],
    ]);
  });
});
