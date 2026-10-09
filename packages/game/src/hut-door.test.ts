import type { SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { HutDoor } from './hut-door';
import type { HutDoorInput } from './hut-door.types';

const at = (sitting: Partial<SittingView> | null): HutDoorInput => ({
  campaign: {
    id: 'c1',
    title: 'Add sign-in',
    status: 'planning',
  } as NonNullable<HutDoorInput>['campaign'],
  sitting: sitting ? ({ id: 's1', status: 'deliberating', ...sitting } as SittingView) : null,
});

describe('HutDoor (#245)', () => {
  it('shows the hut while the council sits, and the map otherwise', () => {
    const door = new HutDoor();
    expect(door.see(null)).toBeNull();
    expect(door.see(at(null))).toBeNull();
    expect(door.see(at({}))).toBe('sitting');
    expect(door.see(at({ status: 'awaitingApproval' }))).toBe('sitting');
    expect(door.see(at({ status: 'approved' }))).toBeNull();
  });

  it('stays shut after the user leaves, while the same sitting goes on', () => {
    const door = new HutDoor();
    door.leave(at({}));
    expect(door.see(at({}))).toBeNull();
    // The council keeps working: a plan proposed meanwhile waits for the user to come back.
    expect(door.see(at({ status: 'awaitingApproval' }))).toBeNull();
  });

  it('opens again when the user comes back', () => {
    const door = new HutDoor();
    door.leave(at({}));
    door.enter();
    expect(door.see(at({}))).toBe('sitting');
  });

  it('opens for a new sitting', () => {
    const door = new HutDoor();
    door.leave(at({}));
    expect(door.see(at({ id: 's2', status: 'convening' }))).toBe('sitting');
  });

  it('leaving with no sitting remembers nothing', () => {
    const door = new HutDoor();
    door.leave(at(null));
    expect(door.see(at({}))).toBe('sitting');
  });
});
