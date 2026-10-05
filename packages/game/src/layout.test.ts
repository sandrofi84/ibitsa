import type { Snapshot } from '@ibitsa/protocol';
import { describe, expect, it } from 'vitest';
import { heroSpot, islandWidth, layoutWorld, pathTo } from './layout';

const withTasks = (n: number): Snapshot => ({
  campaign: null,
  heroes: [],
  needsYou: [],
  islands: [
    {
      id: 'i2',
      name: 'Island',
      branch: 'b',
      worktree: 'ready',
      taskPoints: Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        title: '',
        state: 'locked' as const,
      })),
    },
  ],
});

describe('layoutWorld', () => {
  it('has a village and no islands before a quest', () => {
    const l = layoutWorld(null);
    expect(l.islands).toEqual([]);
    expect(l.village.door).toEqual({ x: 80, y: 182 });
  });

  it('widens islands in whole middle slices and keeps task points inside, on the canvas', () => {
    for (const n of [1, 2, 3, 5]) {
      const island = layoutWorld(withTasks(n)).islands[0];
      if (!island) throw new Error('no island');
      expect(island.width).toBe(islandWidth(island.middles));
      const xs = island.taskPoints.map((t) => t.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(island.x + 8);
      expect(Math.max(...xs) + 16).toBeLessThanOrEqual(island.x + island.width - 8);
      expect(island.x + island.width).toBeLessThanOrEqual(480);
    }
  });

  it('puts a hero on its task point and routes the path there from the door', () => {
    const l = layoutWorld(withTasks(1));
    const spot = heroSpot(l, 't0');
    const path = pathTo(l, 't0');
    expect(path[0]).toEqual({ x: 80, y: 186 });
    expect(path.at(-1)).toEqual(spot);
  });
});
