import type { SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { councillorTitle, hutFromSitting, isSitting, SittingFeed } from './sitting-hut';

const sitting = (over: Partial<SittingView> = {}): SittingView => ({
  id: 's1',
  task: 'Add sign-in',
  mode: 'roundTable',
  status: 'deliberating',
  effort: 'standard',
  roster: [
    { councillorId: 'architect', effort: 'standard', reported: true },
    { councillorId: 'security', effort: 'standard', reported: false },
  ],
  reports: [],
  questions: null,
  dialogue: [],
  plans: [],
  revision: 0,
  reconsultations: [],
  gold: { kind: 'unknown' },
  error: null,
  ...over,
});

const question = (id: string, councillorId: string) => ({
  id,
  councillorId,
  question: 'Q?',
  options: [],
  allowFreeText: true,
});

describe('hutFromSitting (#102)', () => {
  it('seats the elder with the roster, each with its report and look', () => {
    const view = hutFromSitting({ sitting: sitting(), focus: null });
    expect(view.councillors).toEqual([
      {
        id: 'elder',
        title: 'Elder',
        appearance: 'councillor.elder',
        report: 'filed',
        raisedHand: false,
      },
      {
        id: 'architect',
        title: 'Architect',
        appearance: 'councillor.default',
        report: 'filed',
        raisedHand: false,
      },
      {
        id: 'security',
        title: 'Security',
        appearance: 'councillor.default',
        report: 'pending',
        raisedHand: false,
      },
    ]);
    expect(view).toMatchObject({
      mode: 'roundTable',
      step: 'research',
      stage: 'dialogue',
      speaker: null,
    });
  });

  it('studies in separate chambers until every report is in', () => {
    expect(hutFromSitting({ sitting: sitting({ mode: 'chambers' }), focus: null }).stage).toBe(
      'study',
    );
    const allIn = sitting({
      mode: 'chambers',
      roster: [{ councillorId: 'architect', effort: 'deep', reported: true }],
    });
    expect(hutFromSitting({ sitting: allIn, focus: null })).toMatchObject({
      stage: 'dialogue',
      step: 'questions',
    });
  });

  it('gives the focused question’s councillor the floor; others asking raise their hands', () => {
    const asking = sitting({
      questions: {
        batchId: 'b1',
        items: [question('q1', 'architect'), question('q2', 'security')],
      },
    });
    const view = hutFromSitting({ sitting: asking, focus: 'q2' });
    expect(view.speaker).toBe('security');
    expect(view.step).toBe('questions');
    expect(view.councillors.map((c) => [c.id, c.raisedHand])).toEqual([
      ['elder', false],
      ['architect', true],
      ['security', false],
    ]);
    expect(hutFromSitting({ sitting: asking, focus: null }).speaker).toBeNull();
  });

  it('lets the last speaker keep the floor, not you; the elder presents the plan', () => {
    const talk = (speaker: string) => sitting({ dialogue: [{ id: 'd1', speaker, text: '…' }] });
    expect(hutFromSitting({ sitting: talk('security'), focus: null }).speaker).toBe('security');
    expect(hutFromSitting({ sitting: talk('you'), focus: null }).speaker).toBeNull();
    expect(
      hutFromSitting({ sitting: sitting({ status: 'awaitingApproval' }), focus: null }),
    ).toMatchObject({ speaker: 'elder', step: 'plan' });
  });

  it('follows the sitting through its steps', () => {
    const step = (status: SittingView['status']) =>
      hutFromSitting({ sitting: sitting({ status }), focus: null }).step;
    expect([step('convening'), step('deliberating'), step('approved')]).toEqual([
      'goal',
      'research',
      'dispatch',
    ]);
  });
});

describe('the sitting in the game (#102)', () => {
  it('counts as sitting until it ends', () => {
    expect(isSitting(null)).toBe(false);
    expect(isSitting(undefined)).toBe(false);
    expect(isSitting(sitting({ status: 'convening' }))).toBe(true);
    expect(isSitting(sitting({ status: 'awaitingApproval' }))).toBe(true);
    for (const status of ['approved', 'dismissed', 'failed'] as const)
      expect(isSitting(sitting({ status }))).toBe(false);
  });

  it('titles councillors from their ids', () => {
    expect(['security', 'api-design', 'elder'].map(councillorTitle)).toEqual([
      'Security',
      'Api design',
      'Elder',
    ]);
  });

  it('feeds the hut a new view only when it changes', () => {
    const feed = new SittingFeed();
    const seen: string[] = [];
    const off = feed.onChange((v) => seen.push(v.step));
    feed.update({ sitting: sitting(), focus: null });
    feed.update({ sitting: sitting(), focus: null });
    feed.update({ sitting: sitting({ status: 'awaitingApproval' }), focus: null });
    expect(seen).toEqual(['research', 'plan']);
    expect(feed.view.step).toBe('plan');
    off();
    feed.update({ sitting: sitting(), focus: null });
    expect(seen).toHaveLength(2);
  });
});
