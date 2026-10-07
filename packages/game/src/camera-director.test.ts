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
    elder: null,
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

describe('which hero the camera follows (#124)', () => {
  const two = (states: [ExecutionState['kind'], ExecutionState['kind']]): Snapshot => {
    const one = snapshot({ state: states[0] });
    const hero = one.heroes[0];
    if (!hero) throw new Error('no hero');
    return {
      ...one,
      heroes: [hero, { ...hero, id: 'h7', state: { kind: states[1] } as ExecutionState }],
    };
  };

  it('follows the selected hero, else the first one working, else the first', () => {
    expect(CameraDirector.focusOf(two(['idle', 'working']), 'h4')?.id).toBe('h4');
    expect(CameraDirector.focusOf(two(['idle', 'working']), null)?.id).toBe('h7');
    expect(CameraDirector.focusOf(two(['idle', 'idle']), 'gone')?.id).toBe('h4');
    expect(CameraDirector.focusOf(snapshot({ state: null }), null)).toBeUndefined();
  });

  it('forgets what the last hero was doing when it switches, so the new one arriving counts', () => {
    const d = new CameraDirector({ auto: true });
    d.observe(two(['traveling', 'traveling']), 'h4');
    d.overview();
    // h7 arrives while h4 is selected: nothing for the camera to see.
    d.observe(two(['traveling', 'idle']), 'h4');
    expect(d.current).toEqual(overview);
    // Selecting h7 starts afresh; its next arrival focuses again.
    d.observe(two(['traveling', 'traveling']), 'h7');
    d.observe(two(['traveling', 'idle']), 'h7');
    expect(d.current).toEqual(focused);
  });
});
