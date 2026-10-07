import type { Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LEVELS, soundsFor, voiceDetune, volumeOf } from './sound-cues';

const snap = (s: Partial<Snapshot>): Snapshot =>
  ({
    campaign: null,
    elder: null,
    sitting: null,
    islands: [],
    heroes: [],
    needsYou: [],
    ...s,
  }) as Snapshot;
const campaign = (status: string) => ({ status }) as Snapshot['campaign'];
const island = (
  tasks: Partial<Snapshot['islands'][number]['taskPoints'][number]>[],
  pr?: { state: string },
) =>
  ({
    id: 'i1',
    taskPoints: tasks.map((t, n) => ({ id: `t${n}`, title: '', state: 'active', ...t })),
    remote: pr ? { pullRequest: { number: 1, url: '', base: 'main', ...pr } } : null,
  }) as unknown as Snapshot['islands'][number];
const hero = (state: string, used: number) =>
  ({
    id: 'h1',
    state: { kind: state },
    hp: { kind: 'exact', value: { used, max: 100 } },
  }) as unknown as Snapshot['heroes'][number];

describe('which sounds play (#184)', () => {
  it('plays nothing for the first snapshot', () => {
    expect(soundsFor({ before: null, after: snap({ campaign: campaign('active') }) })).toEqual([]);
  });

  it('marks a campaign starting and ending', () => {
    expect(
      soundsFor({
        before: snap({ campaign: campaign('planning') }),
        after: snap({ campaign: campaign('active') }),
      }),
    ).toEqual([{ slot: 'campaignStart' }]);
    expect(
      soundsFor({
        before: snap({ campaign: campaign('active') }),
        after: snap({ campaign: campaign('finished') }),
      }),
    ).toEqual([{ slot: 'campaignEnd' }]);
  });

  it('marks tasks done and reviews passed or sent back, once each', () => {
    const before = snap({
      islands: [island([{}, {}, { review: { phase: 'reviewing' } as never }])],
    });
    const after = snap({
      islands: [
        island([
          { state: 'done', review: { phase: 'passed' } as never },
          { state: 'doneUnreviewed' },
          { review: { phase: 'changes' } as never },
        ]),
      ],
    });
    expect(soundsFor({ before, after })).toEqual([
      { slot: 'taskDone' },
      { slot: 'reviewPassed' },
      { slot: 'reviewFailed' },
    ]);
  });

  it('marks a PR opened and merged', () => {
    expect(
      soundsFor({
        before: snap({ islands: [island([])] }),
        after: snap({ islands: [island([], { state: 'draft' })] }),
      }),
    ).toEqual([{ slot: 'prOpened' }]);
    expect(
      soundsFor({
        before: snap({ islands: [island([], { state: 'approved' })] }),
        after: snap({ islands: [island([], { state: 'merged' })] }),
      }),
    ).toEqual([{ slot: 'prMerged' }]);
  });

  it('marks a hero crossing into low HP, and resting', () => {
    expect(
      soundsFor({
        before: snap({ heroes: [hero('working', 70)] }),
        after: snap({ heroes: [hero('working', 85)] }),
      }),
    ).toEqual([{ slot: 'hpLow' }]);
    expect(
      soundsFor({
        before: snap({ heroes: [hero('working', 85)] }),
        after: snap({ heroes: [hero('resting', 90)] }),
      }),
    ).toEqual([{ slot: 'resting' }]);
  });

  it("gives a councillor's new line its blip, not the user's", () => {
    const sitting = (lines: string[]) =>
      ({
        id: 's1',
        dialogue: lines.map((speaker, n) => ({ id: `d${n}`, speaker, text: '' })),
      }) as Snapshot['sitting'];
    expect(
      soundsFor({
        before: snap({ sitting: sitting(['you']) }),
        after: snap({ sitting: sitting(['you', 'you', 'security']) }),
      }),
    ).toEqual([{ slot: 'councillorSpeaks', speaker: 'security' }]);
    expect(
      soundsFor({
        before: snap({ sitting: sitting([]) }),
        after: snap({ sitting: sitting(['you']) }),
      }),
    ).toEqual([]);
  });

  it('chimes when something new waits in Needs you, not for what was already there', () => {
    const item = (id: string) =>
      ({ id, kind: 'reply', heroId: 'h1' }) as Snapshot['needsYou'][number];
    expect(
      soundsFor({
        before: snap({ needsYou: [item('n1')] }),
        after: snap({ needsYou: [item('n1'), item('n2')] }),
      }),
    ).toEqual([{ slot: 'needsYou' }]);
    expect(
      soundsFor({ before: snap({ needsYou: [item('n1')] }), after: snap({ needsYou: [] }) }),
    ).toEqual([]);
  });

  it('follows the master and category volumes, and Focus mode keeps all but Needs you quiet', () => {
    expect(volumeOf({ slot: 'taskDone', levels: DEFAULT_LEVELS })).toBe(0.5);
    expect(volumeOf({ slot: 'needsYou', levels: { ...DEFAULT_LEVELS, alerts: 50 } })).toBe(0.25);
    expect(volumeOf({ slot: 'taskDone', levels: { ...DEFAULT_LEVELS, focus: true } })).toBe(0);
    expect(volumeOf({ slot: 'needsYou', levels: { ...DEFAULT_LEVELS, focus: true } })).toBe(0.5);
  });

  it('pitches each councillor the same way every time, within an octave either side', () => {
    expect(voiceDetune('security')).toBe(voiceDetune('security'));
    for (const id of ['security', 'tester', 'architect', 'elder']) {
      expect(Math.abs(voiceDetune(id))).toBeLessThanOrEqual(400);
    }
  });
});
