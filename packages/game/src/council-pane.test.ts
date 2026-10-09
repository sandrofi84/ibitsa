import type { CouncilReport, SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { conversation, councilState, journalOf, reportRows } from './council-pane';

const REPORT: CouncilReport = {
  concerns: [{ summary: 'No Gatsby here', severity: 'serious', reason: 'package.json' }],
  questions: ['Wrong repo?', 'Add it fresh?'],
  recommendations: [],
  notChecked: [],
};

const sitting = (over: Partial<SittingView> = {}): SittingView =>
  ({
    id: 's1',
    mode: 'chambers',
    status: 'deliberating',
    roster: [
      { councillorId: 'architect', effort: 'standard', reported: true },
      { councillorId: 'tester', effort: 'light', reported: false },
    ],
    reports: [{ id: 'r1', councillorId: 'architect', revision: 0, report: REPORT }],
    questions: null,
    dialogue: [],
    waiting: false,
    ...over,
  }) as unknown as SittingView;

const question = { id: 'q1', councillorId: 'architect' } as NonNullable<
  SittingView['questions']
>['items'][number];

describe('what the council is doing (#242)', () => {
  it('says so in one line, whatever the sitting is at', () => {
    expect(councilState(sitting({ status: 'convening' }))).toBe('The council is gathering…');
    expect(councilState(sitting())).toBe(
      'Councillors are studying in their chambers: 1 of 2 reports in.',
    );
    expect(councilState(sitting({ mode: 'roundTable' }))).toBe(
      'The council is reporting: 1 of 2 reports in.',
    );
    const allIn = sitting({
      roster: [{ councillorId: 'architect', effort: 'standard', reported: true }],
    });
    expect(councilState(allIn)).toBe('The council is deliberating…');
    expect(councilState({ ...allIn, waiting: true })).toBe(
      'The council is waiting on you: tell it something, or dismiss it.',
    );
    expect(councilState(sitting({ questions: { batchId: 'b1', items: [question] } }))).toBe(
      'The council has questions for you.',
    );
    expect(councilState(sitting({ status: 'awaitingApproval' }))).toBe(
      'A plan is waiting for your approval.',
    );
  });

  it("gives each councillor's latest report in brief, or that it is still studying", () => {
    expect(reportRows(sitting())).toEqual([
      {
        councillorId: 'architect',
        title: 'Architect',
        filed: true,
        detail: '1 concern, 2 questions',
      },
      { councillorId: 'tester', title: 'Tester', filed: false, detail: 'studying…' },
    ]);
    const bowed = sitting({
      reports: [
        { id: 'r1', councillorId: 'architect', revision: 0, report: REPORT },
        {
          id: 'r2',
          councillorId: 'architect',
          revision: 1,
          report: { ...REPORT, bowOut: 'Nothing in my field' },
        },
      ],
    });
    expect(reportRows(bowed)[0]?.detail).toBe('Nothing in my field');
  });
});

describe("the council's words (#242)", () => {
  const said = [
    { id: 'd1', speaker: 'you', text: 'Why?', questionId: 'q1' },
    { id: 'd2', speaker: 'architect', text: 'Because.', questionId: 'q1' },
    { id: 'd3', speaker: 'elder', text: 'There is nothing to plan here.' },
  ];

  it('journals everything said, each speaker named', () => {
    expect(journalOf(sitting({ dialogue: said }))).toEqual([
      { id: 'd1', speaker: 'you', name: 'You', text: 'Why?' },
      { id: 'd2', speaker: 'architect', name: 'Architect', text: 'Because.' },
      { id: 'd3', speaker: 'elder', name: 'Elder', text: 'There is nothing to plan here.' },
    ]);
  });

  const named = (ids: string[]) => (c: ReturnType<typeof conversation>) =>
    expect(c?.lines.map((l) => l.id)).toEqual(ids);

  it("reads top to bottom (#268): the council's latest word, then what the user said since", () => {
    const told = [...said, { id: 'd4', speaker: 'you', text: 'Add it fresh.' }];
    named(['d3'])(conversation(sitting({ dialogue: said })));
    named(['d3', 'd4'])(conversation(sitting({ dialogue: told })));
    expect(conversation(sitting({ dialogue: told }))?.note).toBe('The council is thinking…');
    // The answer follows the line it answers.
    const answered = [...told, { id: 'd5', speaker: 'architect', text: 'Then it is a new site.' }];
    named(['d4', 'd5'])(conversation(sitting({ dialogue: answered })));
    expect(conversation(sitting({ dialogue: answered }))?.note).toBeNull();
  });

  it('says the council waits on the user last, just above the bar that answers it', () => {
    expect(conversation(sitting({ dialogue: said, waiting: true }))?.note).toBe(
      'The council is waiting on you: reply below, or dismiss it from the council pane.',
    );
  });

  it("shows the user's words before the council has said anything, and nothing when nobody has", () => {
    named(['d1'])(
      conversation(sitting({ dialogue: [{ id: 'd1', speaker: 'you', text: 'Hello' }] })),
    );
    expect(conversation(sitting())).toBeNull();
  });

  it('leaves a question still open to the dialogue box', () => {
    const open = { batchId: 'b1', items: [question] };
    expect(conversation(sitting({ dialogue: said.slice(0, 2), questions: open }))).toBeNull();
    // Once the question is answered, its last line is just the council's latest word.
    named(['d1', 'd2'])(conversation(sitting({ dialogue: said.slice(0, 2) })));
  });

  it('keeps to the last few lines however much the user says', () => {
    const many = [
      ...said,
      ...[4, 5, 6, 7, 8].map((n) => ({ id: `d${n}`, speaker: 'you', text: `line ${n}` })),
    ];
    named(['d5', 'd6', 'd7', 'd8'])(conversation(sitting({ dialogue: many })));
  });
});
