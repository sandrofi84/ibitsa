import type { HeroView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { activityMoment, availablePose, heroMoment, heroPose, POSE_FALLBACK } from './poses';
import type { MapPose } from './poses.types';

describe('heroPose (#222)', () => {
  const pose = (state: HeroView['state']['kind'], kind?: 'test' | 'edit' | 'run' | 'think') =>
    heroPose({ state, activity: kind ? { kind } : null, walking: false });

  it('strikes the pose of each moment', () => {
    expect(pose('blocked')).toBe('blocked');
    expect(pose('waitingOnYou')).toBe('ask');
    expect(pose('resting')).toBe('rest');
    expect(pose('outOfGold')).toBe('outOfGold');
    expect(pose('working', 'test')).toBe('test');
    expect(pose('working', 'edit')).toBe('work');
    expect(pose('working', 'run')).toBe('work');
  });

  it('stands idle while thinking, between activities and in the other states', () => {
    expect(pose('working', 'think')).toBe('idle');
    expect(pose('working')).toBe('idle');
    for (const state of [
      'idle',
      'submitted',
      'underReview',
      'stalled',
      'error',
      'unknown',
    ] as const)
      expect(pose(state)).toBe('idle');
  });

  it('walks while travelling or still on its way, whatever the state', () => {
    expect(pose('traveling')).toBe('walk');
    expect(heroPose({ state: 'blocked', activity: null, walking: true })).toBe('walk');
    expect(heroPose({ state: 'working', activity: { kind: 'test' }, walking: true })).toBe('walk');
  });
});

describe('availablePose (§9.2 fallbacks)', () => {
  const only =
    (...poses: MapPose[]) =>
    (p: MapPose) =>
      poses.includes(p);

  it('shows a pose the sheet has', () => {
    expect(availablePose({ pose: 'ask', has: only('idle', 'walk', 'work', 'ask') })).toBe('ask');
  });

  it('falls back as the map did before it had the pose', () => {
    const required = only('idle', 'walk', 'work');
    expect(availablePose({ pose: 'test', has: required })).toBe('work');
    for (const pose of ['ask', 'blocked', 'rest', 'review', 'outOfGold'] as const)
      expect(availablePose({ pose, has: required })).toBe('idle');
  });

  it('skips the brief poses a sheet lacks, and anything with no pose left', () => {
    expect(availablePose({ pose: 'celebrate', has: only('idle') })).toBeNull();
    expect(availablePose({ pose: 'hurt', has: only('idle') })).toBeNull();
    expect(availablePose({ pose: 'test', has: only() })).toBeNull();
  });

  it('ends every chain at a required pose or a brief one, in a few steps', () => {
    for (const start of Object.keys(POSE_FALLBACK) as MapPose[]) {
      let p: MapPose | null = start;
      let last: MapPose = start;
      let steps = 0;
      while (p !== null) {
        last = p;
        p = POSE_FALLBACK[p];
        steps++;
      }
      expect(steps).toBeLessThanOrEqual(3);
      expect(['idle', 'walk', 'work', 'celebrate', 'hurt']).toContain(last);
    }
  });
});

describe('brief poses (#222)', () => {
  it('celebrates when the work is handed in, once', () => {
    expect(heroMoment({ previous: 'working', next: 'submitted' })).toBe('celebrate');
    expect(heroMoment({ previous: 'submitted', next: 'submitted' })).toBeNull();
    expect(heroMoment({ previous: 'working', next: 'idle' })).toBeNull();
  });

  it('flinches at a failed test, not at a passing one or another failure', () => {
    expect(activityMoment({ kind: 'test', outcome: 'failed' })).toBe('hurt');
    expect(activityMoment({ kind: 'test', outcome: 'ok' })).toBeNull();
    expect(activityMoment({ kind: 'run', outcome: 'failed' })).toBeNull();
    expect(activityMoment({ outcome: 'failed' })).toBeNull();
  });
});
