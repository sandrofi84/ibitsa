import type { CouncilReport, SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { councilState, journalOf, latestWord, reportRows } from './council-pane';

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

  it('shows its latest word, unless the user spoke last or the dialogue box has it', () => {
    expect(latestWord(sitting({ dialogue: said }))).toMatchObject({
      speaker: 'elder',
      text: 'There is nothing to plan here.',
    });
    expect(latestWord(sitting({ dialogue: said.slice(0, 1) }))).toBeNull();
    expect(latestWord(sitting())).toBeNull();
    const open = { batchId: 'b1', items: [question] };
    expect(latestWord(sitting({ dialogue: said.slice(0, 2), questions: open }))).toBeNull();
    // Once the question is answered, its last line is just the council's latest word.
    expect(latestWord(sitting({ dialogue: said.slice(0, 2) }))).toMatchObject({ id: 'd2' });
  });
});
