import type { ElderView, SittingView, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { elderHut } from './elder-hut';
import { councilPose, seatHut, walkIns } from './hut-view';

const elder = (status: ElderView['status']): ElderView => ({
  id: 'e1',
  task: 'Add sign-in',
  status,
  progress: null,
  brief: null,
  gold: { kind: 'unknown' },
  error: status === 'failed' ? 'Out of gold.' : null,
});

const snapshot = (over: Partial<Snapshot>): Snapshot =>
  ({
    campaign: { id: 'c1', title: 'Add sign-in', status: 'planning' },
    elder: null,
    sitting: null,
    ...over,
  }) as Snapshot;

const approvedSitting = {
  id: 's1',
  status: 'approved',
  plans: [
    {
      version: 1,
      outcome: { kind: 'approved' },
      plan: { decisions: [{ id: 'D1' }, { id: 'D2' }] },
    },
  ],
} as unknown as SittingView;

describe('elderHut (#244)', () => {
  it('welcomes with the elder alone, who walks in through the door', () => {
    const view = elderHut(null);
    expect(view.mode).toBeNull();
    expect(view.step).toBe('goal');
    expect(view.councillors.map((c) => c.id)).toEqual(['elder']);
    expect(view.speaker).toBeNull();
    const walks = walkIns({
      seats: seatHut(view, 480),
      seated: new Set(),
      first: true,
      view,
      reducedMotion: false,
    });
    expect(walks.map((w) => w.id)).toEqual(['elder']);
  });

  it('studies the old charts while the elder researches', () => {
    const view = elderHut(snapshot({ elder: elder('researching') }));
    expect(view).toMatchObject({ step: 'research', stage: 'study', speaker: null });
    expect(councilPose(view, 'elder')).toBe('think');
  });

  it('gives the elder the floor with its brief, or why it failed', () => {
    for (const status of ['briefed', 'failed'] as const) {
      const view = elderHut(snapshot({ elder: elder(status) }));
      expect(view).toMatchObject({ step: 'research', stage: 'dialogue', speaker: 'elder' });
      expect(councilPose(view, 'elder')).toBe('talk');
    }
  });

  it("shows the council's approved plan, with its decisions, ready to dispatch", () => {
    const view = elderHut(snapshot({ elder: elder('briefed'), sitting: approvedSitting }));
    expect(view).toMatchObject({ step: 'dispatch', speaker: 'elder', decisions: 2 });
  });

  it("is an empty welcome once the campaign isn't planning", () => {
    const view = elderHut(
      snapshot({
        campaign: { id: 'c1', title: 'x', status: 'finished' } as Snapshot['campaign'],
        elder: elder('briefed'),
      }),
    );
    expect(view).toMatchObject({ step: 'goal', speaker: null, decisions: 0 });
  });
});
