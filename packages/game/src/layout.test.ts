import type { HeroView, IslandView, Snapshot, TaskPointState } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import {
  BRIDGE,
  bridgeState,
  heroSpot,
  heroSpots,
  islandWidth,
  layoutWorld,
  overviewCenter,
  pathTo,
  reviewerPath,
  reviewerSide,
  reviewerSpot,
  villageSpot,
  WORLD,
} from './layout';

const island = (
  id: string,
  { tasks = 1, worktree = 'ready', states = [] as TaskPointState[], behind = false } = {},
): IslandView => ({
  id,
  name: id,
  branch: `ibitsa/${id}`,
  worktree: worktree as IslandView['worktree'],
  basedOn: null,
  behind,
  remote: null,
  pullRequestDraft: null,
  taskPoints: Array.from({ length: tasks }, (_, i) => ({
    id: `${id}-t${i}`,
    title: '',
    state: states[i] ?? 'locked',
  })),
});

const snapshot = ({
  islands,
  branching = 'separate',
  stackedStart = null,
  heroes = [],
}: {
  islands: IslandView[];
  branching?: 'separate' | 'stacked';
  stackedStart?: 'cleared' | 'together' | null;
  heroes?: HeroView[];
}): Snapshot => ({
  campaign: {
    id: 'c',
    title: 'C',
    status: 'active',
    gold: { kind: 'unknown' },
    autoApprove: false,
    branching,
    stackedStart,
    capMicroUsd: null,
    maxParallel: 2,
    shipped: false,
    ending: null,
  },
  heroes,
  needsYou: [],
  elder: null,
  sitting: null,
  islands,
});

const islands = (n: number, tasks = 1) =>
  Array.from({ length: n }, (_, k) => island(`i${k}`, { tasks }));

const overlaps = (a: { x: number; y: number; width: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y === b.y;

describe('layoutWorld', () => {
  it('has a village and no islands before a quest, on the 480×270 world', () => {
    const l = layoutWorld(null);
    expect(l.islands).toEqual([]);
    expect(l.bridges).toEqual([]);
    expect(l.village.door).toEqual({ x: 80, y: 192 });
    expect(l.bounds).toEqual({ x: 0, y: 0, width: 480, height: 270 });
  });

  it('widens islands in whole middle slices and keeps task points inside, on the canvas', () => {
    for (const n of [1, 2, 3, 5]) {
      const one = layoutWorld(snapshot({ islands: [island('i', { tasks: n })] })).islands[0];
      if (!one) throw new Error('no island');
      expect(one.width).toBe(islandWidth(one.middles));
      const xs = one.taskPoints.map((t) => t.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(one.x + 8);
      expect(Math.max(...xs) + 16).toBeLessThanOrEqual(one.x + one.width - 8);
      expect(one.x + one.width).toBeLessThanOrEqual(480);
    }
  });

  it('fans separate islands out column by column, bottom then top, never overlapping, on two rows', () => {
    for (let n = 1; n <= 8; n++) {
      const l = layoutWorld(snapshot({ islands: islands(n, 2) }));
      expect(l.islands).toHaveLength(n);
      expect(l.islands[0]).toMatchObject({ x: 176, row: 'bottom' });
      if (n > 1) expect(l.islands[1]).toMatchObject({ x: 176, row: 'top' });
      for (const [a, b] of pairs(l.islands)) expect(overlaps(a, b)).toBe(false);
      for (const i of l.islands) {
        expect(i.y + 96).toBeLessThanOrEqual(WORLD.height);
        expect(i.x).toBeGreaterThan(l.village.x + islandWidth(l.village.middles));
      }
      expect(l.bridges).toEqual([]);
    }
  });

  it('widens the world past four islands and keeps its height', () => {
    const four = layoutWorld(snapshot({ islands: islands(4) }));
    expect(four.bounds.width).toBe(480);
    const six = layoutWorld(snapshot({ islands: islands(6) }));
    const last = six.islands[5];
    if (!last) throw new Error('no island');
    expect(six.bounds).toEqual({ x: 0, y: 0, width: last.x + last.width + 16, height: 270 });
    expect(six.bounds.width).toBeGreaterThan(480);
  });

  it('runs stacked islands along the bottom row, bridged, then up and back along the top', () => {
    const l = layoutWorld(snapshot({ islands: islands(6), branching: 'stacked' }));
    const rows = l.islands.map((i) => i.row);
    expect(rows).toEqual(['bottom', 'bottom', 'bottom', 'bottom', 'top', 'top']);
    expect(l.islands[4]?.x).toBe(l.islands[3]?.x);
    expect((l.islands[5]?.x ?? 0) < (l.islands[4]?.x ?? 0)).toBe(true);
    expect(l.bridges.map((b) => [b.from, b.to, b.vertical])).toEqual([
      ['i0', 'i1', false],
      ['i1', 'i2', false],
      ['i2', 'i3', false],
      ['i3', 'i4', true],
      ['i4', 'i5', false],
    ]);
    for (const b of l.bridges) expect(b.length).toBe(BRIDGE.span);
    // Each row's bridge starts where the island on its left ends.
    const first = l.bridges[0];
    const a = l.islands[0];
    expect(first?.x).toBe((a?.x ?? 0) + (a?.width ?? 0));
    for (const [p, q] of pairs(l.islands)) expect(overlaps(p, q)).toBe(false);
  });

  it('keeps a long stacked top row on the map, widening it to the left if it must', () => {
    const wide = Array.from({ length: 8 }, (_, k) => island(`i${k}`, { tasks: k < 4 ? 1 : 6 }));
    const l = layoutWorld(snapshot({ islands: wide, branching: 'stacked' }));
    const leftmost = Math.min(...l.islands.map((i) => i.x));
    expect(l.bounds.x).toBe(Math.min(0, leftmost - 16));
    expect(overviewCenter(l)).toEqual({ x: l.bounds.x + 240, y: 135 });
  });
});

describe('where heroes stand and walk', () => {
  const hero = (id: string, [islandId, taskPointId]: [string, string]): HeroView => ({
    id,
    name: id,
    classId: 'ranger',
    islandId,
    taskPointId,
    state: { kind: 'idle' },
    activity: null,
    hp: { kind: 'unknown' },
    gold: { kind: 'unknown' },
    queuedMessages: 0,
  });

  it('puts a hero on its task point and routes the path there from the door', () => {
    const l = layoutWorld(snapshot({ islands: [island('i')] }));
    const spot = heroSpot(l, 'i-t0');
    const path = pathTo(l, 'i-t0');
    expect(path).toEqual([{ x: 80, y: 196 }, { x: 168, y: spot.y }, spot]);
    expect(heroSpot(l, 'nowhere')).toEqual({ x: 80, y: 196 });
    expect(pathTo(l, 'nowhere')).toEqual([{ x: 80, y: 196 }]);
  });

  it('routes a stacked hero across the islands and bridges before its own, never through the sea', () => {
    const l = layoutWorld(snapshot({ islands: islands(6), branching: 'stacked' }));
    const third = pathTo(l, 'i2-t0');
    const end = heroSpot(l, 'i2-t0');
    expect(third).toEqual([
      { x: 80, y: 196 },
      { x: 168, y: end.y },
      { x: (l.bridges[0]?.x ?? 0) + 24, y: end.y },
      { x: (l.bridges[1]?.x ?? 0) + 24, y: end.y },
      end,
    ]);
    // Up the bridge between the rows to the top row.
    const fifth = pathTo(l, 'i4-t0');
    const up = l.bridges[3];
    expect(fifth.at(-2)).toEqual({ x: (up?.x ?? 0) + 12, y: (up?.y ?? 0) + 24 });
    expect(fifth.at(-1)).toEqual(heroSpot(l, 'i4-t0'));
  });

  it('routes paths to islands further out through the channel between the rows', () => {
    const l = layoutWorld(snapshot({ islands: islands(3) }));
    for (const id of ['i1-t0', 'i2-t0']) {
      const path = pathTo(l, id);
      expect(path).toHaveLength(5);
      expect(path[1]).toEqual({ x: 150, y: 136 });
      expect(path.at(-1)).toEqual(heroSpot(l, id));
    }
  });

  it('lines up the heroes of waiting islands at the village, the others on their task points', () => {
    const s = snapshot({
      islands: [
        island('a'),
        island('b', { worktree: 'waiting' }),
        island('c', { worktree: 'waiting' }),
      ],
      heroes: [hero('h1', ['a', 'a-t0']), hero('h2', ['b', 'b-t0']), hero('h3', ['c', 'c-t0'])],
    });
    const l = layoutWorld(s);
    const spots = heroSpots(l, s);
    expect(spots.get('h1')).toEqual(heroSpot(l, 'a-t0'));
    expect(spots.get('h2')).toEqual(villageSpot(l, 0));
    expect(spots.get('h3')).toEqual(villageSpot(l, 1));
    expect(villageSpot(l, 0)).toEqual({ x: 60, y: 196 });
    expect(villageSpot(l, 4)).toEqual({ x: 60, y: 208 });
  });
});

describe('bridgeState', () => {
  it('lowers the bridge once the island before is cleared', () => {
    const before = snapshot({
      islands: [island('a', { states: ['active'] }), island('b', { worktree: 'waiting' })],
      branching: 'stacked',
      stackedStart: 'cleared',
    });
    expect(bridgeState({ snapshot: before, to: 'b' })).toEqual({ lowered: false, behind: false });
    const after = snapshot({
      islands: [island('a', { states: ['doneUnreviewed'] }), island('b', { worktree: 'waiting' })],
      branching: 'stacked',
      stackedStart: 'cleared',
    });
    expect(bridgeState({ snapshot: after, to: 'b' }).lowered).toBe(true);
  });

  it('all at once: lowered once the island has started; behind when it must catch up', () => {
    const s = snapshot({
      islands: [
        island('a', { states: ['active'] }),
        island('b', { behind: true }),
        island('c', { worktree: 'waiting' }),
      ],
      branching: 'stacked',
      stackedStart: 'together',
    });
    expect(bridgeState({ snapshot: s, to: 'b' })).toEqual({ lowered: true, behind: true });
    expect(bridgeState({ snapshot: s, to: 'c' })).toEqual({ lowered: false, behind: false });
    expect(bridgeState({ snapshot: s, to: 'nowhere' })).toEqual({ lowered: false, behind: false });
  });
});

describe('reviewers on the map (#140)', () => {
  const layout = layoutWorld(snapshot({ islands: [island('a', { tasks: 2 })] }));

  it('stand around the hero, right then left, above then below, clear of the task points beside', () => {
    const hero = heroSpot(layout, 'a-t0');
    const spots = [0, 1, 2, 3].map((index) => reviewerSpot(layout, { taskPointId: 'a-t0', index }));
    expect(spots).toEqual([
      { x: hero.x + 18, y: hero.y - 14 },
      { x: hero.x + 18, y: hero.y + 14 },
      { x: hero.x - 18, y: hero.y - 14 },
      { x: hero.x - 18, y: hero.y + 14 },
    ]);
    // A 16-pixel token never reaches the hero standing on the next task point.
    const next = heroSpot(layout, 'a-t1');
    expect(Math.max(...spots.map((s) => s.x)) + 9).toBeLessThan(next.x - 8);
    expect([0, 1, 2, 3, 4].map(reviewerSide)).toEqual([1, 1, -1, -1, 1]);
    expect(reviewerSpot(layout, { taskPointId: 'a-t0', index: 4 })).toEqual({
      x: hero.x + 38,
      y: hero.y - 14,
    });
  });

  it('walk from the council hut along the hero path, ending at their place', () => {
    const path = reviewerPath(layout, { taskPointId: 'a-t0', index: 1 });
    const hero = pathTo(layout, 'a-t0');
    expect(path.slice(0, -1)).toEqual(hero.slice(0, -1));
    expect(path.at(-1)).toEqual(reviewerSpot(layout, { taskPointId: 'a-t0', index: 1 }));
  });
});

function pairs<T>(items: T[]): [T, T][] {
  return items.flatMap((a, i) => items.slice(i + 1).map((b): [T, T] => [a, b]));
}
