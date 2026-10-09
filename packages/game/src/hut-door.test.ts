import type { CampaignView, ElderView, SittingView } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { HutDoor } from './hut-door';
import type { HutDoorInput } from './hut-door.types';

const campaign = (status: CampaignView['status'], id = 'c1') =>
  ({ id, title: 'Add sign-in', status }) as CampaignView;

/** A planning campaign, with a sitting or none. */
const elder = { id: 'e1', status: 'briefed' } as ElderView;

/** A planning campaign the elder researched, with a sitting or none. */
const at = (sitting: Partial<SittingView> | null): HutDoorInput => ({
  campaign: campaign('planning'),
  elder,
  sitting: sitting ? ({ id: 's1', status: 'deliberating', ...sitting } as SittingView) : null,
});

const none: HutDoorInput = { campaign: null, elder: null, sitting: null };

describe('HutDoor', () => {
  describe('the welcome (#244)', () => {
    it('stays on the map with no campaign until the user walks in', () => {
      const door = new HutDoor();
      expect(door.see(null)).toBeNull();
      expect(door.see(none)).toBeNull();
      door.enter();
      expect(door.see(none)).toBe('elder');
      // After a finished or abandoned campaign too.
      expect(door.see({ campaign: campaign('finished'), elder: null, sitting: null })).toBe(
        'elder',
      );
    });

    it('goes on with the elder once the welcome asks it to research', () => {
      const door = new HutDoor();
      door.enter();
      expect(door.see(at(null))).toBe('elder');
      // The welcome is over: abandoning the campaign returns to the map.
      expect(door.see({ campaign: campaign('abandoned'), elder: null, sitting: null })).toBeNull();
    });

    it('ends with a quick quest, on the map', () => {
      const door = new HutDoor();
      door.enter();
      expect(door.see({ campaign: campaign('active'), elder: null, sitting: null })).toBeNull();
      expect(door.see({ campaign: campaign('finished'), elder: null, sitting: null })).toBeNull();
    });

    it('ends when its form is cancelled', () => {
      const door = new HutDoor();
      door.enter();
      door.endWelcome();
      expect(door.see(none)).toBeNull();
    });

    it("leaving by the door ends it, but cancelling a planning campaign's form doesn't leave", () => {
      const door = new HutDoor();
      door.enter();
      door.leave(none);
      expect(door.see(none)).toBeNull();
      door.endWelcome();
      expect(door.see(at(null))).toBe('elder');
    });
  });

  describe('while a campaign plans', () => {
    it('shows the elder, then the council while it sits, by itself', () => {
      const door = new HutDoor();
      expect(door.see(at(null))).toBe('elder');
      expect(door.see(at({}))).toBe('sitting');
      expect(door.see(at({ status: 'awaitingApproval' }))).toBe('sitting');
      // An approved plan: the elder offers to assemble the parties.
      expect(door.see(at({ status: 'approved' }))).toBe('elder');
      expect(door.see({ campaign: campaign('active'), elder: null, sitting: null })).toBeNull();
    });

    it('stays shut after the user leaves the sitting, and when it ends (#245)', () => {
      const door = new HutDoor();
      door.leave(at({}));
      expect(door.see(at({}))).toBeNull();
      expect(door.see(at({ status: 'awaitingApproval' }))).toBeNull();
      expect(door.see(at({ status: 'dismissed' }))).toBeNull();
    });

    it("stays shut after the user leaves the elder's research", () => {
      const door = new HutDoor();
      door.leave(at(null));
      expect(door.see(at(null))).toBeNull();
    });

    it('opens again when the user comes back', () => {
      const door = new HutDoor();
      door.leave(at({}));
      door.enter();
      expect(door.see(at({}))).toBe('sitting');
    });

    it('opens for a new sitting, convened from the map', () => {
      const door = new HutDoor();
      door.leave(at({}));
      expect(door.see(at({ id: 's2', status: 'convening' }))).toBe('sitting');
      const fromElder = new HutDoor();
      fromElder.leave(at(null));
      expect(fromElder.see(at({ status: 'convening' }))).toBe('sitting');
    });

    it('opens for a new campaign', () => {
      const door = new HutDoor();
      door.leave(at({}));
      expect(door.see({ campaign: campaign('planning', 'c2'), elder, sitting: null })).toBe(
        'elder',
      );
    });

    it('shows the map once a council convened without the elder is dismissed', () => {
      const door = new HutDoor();
      const alone = { campaign: campaign('planning'), elder: null };
      expect(
        door.see({ ...alone, sitting: { id: 's1', status: 'deliberating' } as SittingView }),
      ).toBe('sitting');
      expect(
        door.see({ ...alone, sitting: { id: 's1', status: 'dismissed' } as SittingView }),
      ).toBeNull();
      expect(door.see({ ...alone, sitting: { id: 's1', status: 'approved' } as SittingView })).toBe(
        'elder',
      );
    });
  });
});
