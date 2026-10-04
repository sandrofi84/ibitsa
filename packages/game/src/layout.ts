import type { Snapshot } from '@ibitsa/protocol';

// World map layout, computed in the game from the snapshot (spec §9.1: no coordinates in the protocol).
// All values are in internal pixels on the 480×270 canvas.

export const ISLAND = { height: 96, leftCap: 48, middle: 32, rightCap: 48 } as const;
const TASK_SPACING = 40;
const TASK_SIZE = 16;

export interface Point {
  x: number;
  y: number;
}

export interface IslandLayout {
  id: string;
  x: number;
  y: number;
  middles: number;
  width: number;
  taskPoints: { id: string; x: number; y: number }[];
}

export interface WorldLayout {
  village: { x: number; y: number; middles: number; hut: Point; door: Point };
  islands: IslandLayout[];
}

export function islandWidth(middles: number): number {
  return ISLAND.leftCap + ISLAND.middle * middles + ISLAND.rightCap;
}

export function layoutWorld(snapshot: Snapshot | null): WorldLayout {
  const village = { x: 16, y: 150, middles: 1 };
  const hut = { x: village.x + 32, y: village.y - 30 };
  const layout: WorldLayout = {
    village: { ...village, hut, door: { x: hut.x + 32, y: hut.y + 62 } },
    islands: [],
  };
  (snapshot?.islands ?? []).forEach((island, k) => {
    const n = Math.max(1, island.taskPoints.length);
    const span = TASK_SIZE + TASK_SPACING * (n - 1);
    // room for the task points plus a 40 px margin each side, in whole middle slices
    const middles = Math.max(
      1,
      Math.ceil((span + 80 - ISLAND.leftCap - ISLAND.rightCap) / ISLAND.middle),
    );
    const width = islandWidth(middles);
    const x = 196;
    const y = 40 + k * 112;
    const start = x + Math.round((width - span) / 2);
    layout.islands.push({
      id: island.id,
      x,
      y,
      middles,
      width,
      taskPoints: island.taskPoints.map((tp, i) => ({
        id: tp.id,
        x: start + i * TASK_SPACING,
        y: y + 22,
      })),
    });
  });
  return layout;
}

/** Where a hero stands: feet centred on its task point, or at the village door. */
export function heroSpot(layout: WorldLayout, taskPointId: string | null): Point {
  for (const island of layout.islands) {
    const tp = island.taskPoints.find((t) => t.id === taskPointId);
    if (tp) return { x: tp.x + 8, y: tp.y + 13 };
  }
  return { x: layout.village.door.x, y: layout.village.door.y + 4 };
}

/** The dotted path from the village door to a task point. */
export function pathTo(layout: WorldLayout, taskPointId: string | null): Point[] {
  const door = { x: layout.village.door.x, y: layout.village.door.y + 4 };
  for (const island of layout.islands) {
    const tp = island.taskPoints.find((t) => t.id === taskPointId);
    if (tp) {
      const end = heroSpot(layout, taskPointId);
      return [door, { x: 176, y: 150 }, { x: island.x - 8, y: end.y }, end];
    }
  }
  return [door];
}
