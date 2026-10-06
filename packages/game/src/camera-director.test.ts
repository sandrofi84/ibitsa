import type { ExecutionState, Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { CameraDirector, FOCUS_ZOOM, MAX_ZOOM, OVERVIEW_ZOOM } from './camera-director';

function snapshot({
  state = 'traveling',
  items = [],
  status = 'active',
}: {
  state?: ExecutionState['kind'] | null;
  items?: string[];
  status?: 'active' | 'finished' | null;
} = {}): Snapshot {
  return {
    campaign: status ? { id: 'c1', title: 'Q', status, gold: { kind: 'unknown' } } : null,
    sitting: null,
    islands: [],
    heroes: state
      ? [
          {
            id: 'h4',
            name: 'Ranger Ilse',
            classId: 'ranger',
            islandId: 'i2',
            taskPointId: 't3',
            state: { kind: state } as ExecutionState,
            activity: null,
            hp: { kind: 'unknown' },
            gold: { kind: 'unknown' },
            queuedMessages: 0,
          },
        ]
      : [],
    needsYou: items.map((id) => ({ kind: 'error', id, heroId: 'h4', message: 'x' })),
  } as Snapshot;
}

const focused = { zoom: FOCUS_ZOOM, follow: true };
const overview = { zoom: OVERVIEW_ZOOM, follow: false };

describe('CameraDirector', () => {
  it('shows the whole map until the hero arrives, then focuses and follows it', () => {
    const d = new CameraDirector({ auto: true });
    expect(d.observe(snapshot({ state: 'traveling' }))).toBe(false);
    expect(d.current).toEqual(overview);
    expect(d.observe(snapshot({ state: 'working' }))).toBe(true);
    expect(d.current).toEqual(focused);
  });

  it('stays where you put it while the hero just keeps working', () => {
    const d = new CameraDirector({ auto: true });
    d.observe(snapshot({ state: 'working' }));
    expect(d.zoomOut()).toEqual(overview);
    d.observe(snapshot({ state: 'idle' }));
    d.observe(snapshot({ state: 'working' }));
    expect(d.current).toEqual(overview);
  });

  it('comes back when something needs you, or the hero arrives somewhere new', () => {
    const d = new CameraDirector({ auto: true });
    d.observe(snapshot({ state: 'working' }));
    d.overview();
    d.observe(snapshot({ state: 'waitingOnYou', items: ['n5'] }));
    expect(d.current).toEqual(focused);

    d.overview();
    d.observe(snapshot({ state: 'traveling', items: ['n5'] }));
    expect(d.current).toEqual(overview);
    d.observe(snapshot({ state: 'working', items: ['n5'] }));
    expect(d.current).toEqual(focused);
  });

  it('never moves by itself with auto-focus off', () => {
    const d = new CameraDirector({ auto: false });
    d.observe(snapshot({ state: 'traveling' }));
    d.observe(snapshot({ state: 'working', items: ['n5'] }));
    expect(d.current).toEqual(overview);
    d.setAuto(true);
    expect(d.autoFocus).toBe(true);
    d.observe(snapshot({ state: 'working', items: ['n5', 'n6'] }));
    expect(d.current).toEqual(focused);
  });

  it('zooms within its limits; panning stops following', () => {
    const d = new CameraDirector({ auto: true });
    d.zoomIn();
    d.zoomIn();
    expect(d.zoomIn()).toEqual({ zoom: MAX_ZOOM, follow: true });
    expect(d.pan()).toEqual({ zoom: MAX_ZOOM, follow: false });
    expect(d.zoomOut()).toEqual({ zoom: FOCUS_ZOOM, follow: false });
    d.zoomOut();
    expect(d.zoomOut()).toEqual(overview);
  });

  it('returns to the whole map when the quest ends or there is none', () => {
    const d = new CameraDirector({ auto: true });
    d.observe(snapshot({ state: 'working' }));
    expect(d.observe(snapshot({ state: 'submitted', status: 'finished' }))).toBe(true);
    expect(d.current).toEqual(overview);
    d.observe(snapshot({ state: null, status: null }));
    expect(d.current).toEqual(overview);
  });

  it('does not count items left from an ended quest as new when the next one starts', () => {
    const d = new CameraDirector({ auto: true });
    d.observe(snapshot({ state: 'submitted', status: 'finished', items: ['n5'] }));
    d.observe(snapshot({ state: 'traveling', items: ['n5'] }));
    expect(d.current).toEqual(overview);
  });
});
