import type { Snapshot } from '@ibitsa/protocol';
import type {
  BridgeLayout,
  IslandLayout,
  Placement,
  Point,
  Spot,
  WorldLayout,
} from './layout.types';

// World map layout, computed in the game from the snapshot (spec §9.1: no coordinates in the protocol).
// All values are in internal pixels; the base world is the 480×270 canvas, and it widens when the islands
// don't fit (#124).

export const ISLAND = { height: 96, leftCap: 48, middle: 32, rightCap: 48 } as const;
export const WORLD = { width: 480, height: 270 } as const;
/** A drawbridge: a left end, one repeatable segment and a right end (§9.2). */
export const BRIDGE = { end: 8, segment: 32, height: 24, span: 48 } as const;
const TASK_SPACING = 40;
const TASK_SIZE = 16;
/** Two rows of islands fit the world's height; the sea between them carries the paths. */
const TOP_Y = 16;
const BOTTOM_Y = 160;
const CHANNEL_Y = (TOP_Y + ISLAND.height + BOTTOM_Y) / 2;
const FIRST_X = 176;
const COLUMN_GAP = 24;
/** A stacked plan runs along the bottom row, then snakes back along the top. */
const STACK_PER_ROW = 4;
const MARGIN = 16;

export function islandWidth(middles: number): number {
  return ISLAND.leftCap + ISLAND.middle * middles + ISLAND.rightCap;
}

/** Whole middle slices that hold `n` task points with a margin each side. */
function middlesFor(n: number): number {
  const span = TASK_SIZE + TASK_SPACING * (Math.max(1, n) - 1);
  return Math.max(1, Math.ceil((span + 80 - ISLAND.leftCap - ISLAND.rightCap) / ISLAND.middle));
}

/**
 * Separate plans fan out from Home Village in two rows (§7.2, #124): the first island beside the village,
 * then column by column, bottom and top, each reached by its own path through the channel between the
 * rows. Stacked plans run along the bottom row joined by drawbridges, then up and back along the top.
 */
export function layoutWorld(snapshot: Snapshot | null): WorldLayout {
  const village = { x: 16, y: BOTTOM_Y, middles: 1 };
  const hut = { x: village.x + 32, y: village.y - 30 };
  const islands = snapshot?.islands ?? [];
  const sizes = islands.map((island) => middlesFor(island.taskPoints.length));
  const placed = snapshot?.campaign?.branching === 'stacked' ? stacked(sizes) : separate(sizes);
  const laid: IslandLayout[] = islands.map((island, k) => {
    const spot = placed.spots[k] ?? { x: FIRST_X, y: BOTTOM_Y, row: 'bottom' };
    const middles = sizes[k] ?? 1;
    const width = islandWidth(middles);
    const span = TASK_SIZE + TASK_SPACING * (Math.max(1, island.taskPoints.length) - 1);
    const start = spot.x + Math.round((width - span) / 2);
    return {
      id: island.id,
      x: spot.x,
      y: spot.y,
      row: spot.row,
      middles,
      width,
      taskPoints: island.taskPoints.map((tp, i) => ({
        id: tp.id,
        x: start + i * TASK_SPACING,
        y: spot.y + 22,
      })),
    };
  });
  const bridges = placed.bridges.flatMap(({ from, to }) => {
    const a = laid[from];
    const b = laid[to];
    return a && b ? [bridgeBetween(a, b)] : [];
  });
  const right = Math.max(WORLD.width, ...laid.map((i) => i.x + i.width + MARGIN));
  const left = Math.min(0, ...laid.map((i) => i.x - MARGIN));
  return {
    village: { ...village, hut, door: { x: hut.x + 32, y: hut.y + 62 } },
    islands: laid,
    bridges,
    bounds: { x: left, y: 0, width: right - left, height: WORLD.height },
  };
}

/** Column by column, bottom then top, so the first island sits beside the village. */
function separate(sizes: number[]): Placement {
  const spots: Spot[] = [];
  let x = FIRST_X;
  for (let k = 0; k < sizes.length; k += 2) {
    const column = sizes.slice(k, k + 2).map(islandWidth);
    spots.push({ x, y: BOTTOM_Y, row: 'bottom' });
    if (column.length > 1) spots.push({ x, y: TOP_Y, row: 'top' });
    x += Math.max(...column) + COLUMN_GAP;
  }
  return { spots, bridges: [] };
}

/** Along the bottom row, then up a bridge and back along the top row, each island bridged to the last. */
function stacked(sizes: number[]): Placement {
  const spots: Spot[] = [];
  let x = FIRST_X;
  sizes.forEach((middles, k) => {
    const width = islandWidth(middles);
    if (k < STACK_PER_ROW) {
      spots.push({ x, y: BOTTOM_Y, row: 'bottom' });
      x += width + BRIDGE.span;
      return;
    }
    const before = spots[k - 1] as Spot;
    // The first top island sits above the last bottom one; the rest run back to the left.
    const at = k === STACK_PER_ROW ? before.x : before.x - BRIDGE.span - width;
    spots.push({ x: at, y: TOP_Y, row: 'top' });
  });
  return { spots, bridges: sizes.slice(1).map((_, k) => ({ from: k, to: k + 1 })) };
}

function bridgeBetween(a: IslandLayout, b: IslandLayout): BridgeLayout {
  if (a.row !== b.row) {
    // Up from the bottom row to the top one, near the islands' left edge.
    return {
      from: a.id,
      to: b.id,
      x: b.x + 12,
      y: TOP_Y + ISLAND.height,
      length: BOTTOM_Y - TOP_Y - ISLAND.height,
      vertical: true,
    };
  }
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  return {
    from: a.id,
    to: b.id,
    x: left.x + left.width,
    y: left.y + 18,
    length: right.x - (left.x + left.width),
    vertical: false,
  };
}

/** Where a hero stands: feet centred on its task point, or at the village door. */
export function heroSpot(layout: WorldLayout, taskPointId: string | null): Point {
  for (const island of layout.islands) {
    const tp = island.taskPoints.find((t) => t.id === taskPointId);
    if (tp) return { x: tp.x + 8, y: tp.y + 13 };
  }
  return { x: layout.village.door.x, y: layout.village.door.y + 4 };
}

/** Heroes whose islands haven't started wait in a line at Home Village (#124): the `n`th of them. */
export function villageSpot(layout: WorldLayout, n: number): Point {
  const door = layout.village.door;
  return { x: door.x - 20 - (n % 4) * 12, y: door.y + 4 + Math.floor(n / 4) * 12 };
}

/**
 * Where every hero stands (#124): on its task point, or in the line at the village while its island waits
 * for a slot, a dependency or the island before it.
 */
export function heroSpots(layout: WorldLayout, snapshot: Snapshot): Map<string, Point> {
  const waiting = new Set(
    snapshot.islands.filter((i) => i.worktree === 'waiting').map((i) => i.id),
  );
  const spots = new Map<string, Point>();
  let queued = 0;
  for (const hero of snapshot.heroes) {
    spots.set(
      hero.id,
      waiting.has(hero.islandId)
        ? villageSpot(layout, queued++)
        : heroSpot(layout, hero.taskPointId),
    );
  }
  return spots;
}

/**
 * The dotted path from the village door to a task point: straight to the island beside the village,
 * else through the channel between the rows.
 */
export function pathTo(layout: WorldLayout, taskPointId: string | null): Point[] {
  const door = { x: layout.village.door.x, y: layout.village.door.y + 4 };
  const k = layout.islands.findIndex((i) => i.taskPoints.some((t) => t.id === taskPointId));
  const island = layout.islands[k];
  if (!island) return [door];
  const end = heroSpot(layout, taskPointId);
  const shore = { x: island.x - 8, y: end.y };
  if (island.row === 'bottom' && island.x === FIRST_X) return [door, shore, end];
  const first = layout.islands[0];
  if (layout.bridges.length > 0 && first) {
    // Stacked: across the islands before it and over their bridges, never through the sea.
    const crossings = layout.bridges
      .slice(0, k)
      .map((b) =>
        b.vertical
          ? { x: b.x + BRIDGE.height / 2, y: b.y + b.length / 2 }
          : { x: b.x + b.length / 2, y: end.y },
      );
    return [door, { x: first.x - 8, y: end.y }, ...crossings, end];
  }
  return [door, { x: 150, y: CHANNEL_Y }, { x: island.x - 8, y: CHANNEL_Y }, shore, end];
}

/**
 * A drawbridge into a stacked island (§5.3, #124): lowered once the island before is cleared, or, when
 * the islands start all at once, once this island has started; "behind" when the branch it builds on
 * moved on and rebasing conflicted.
 */
export function bridgeState({ snapshot, to }: { snapshot: Snapshot; to: string }): {
  lowered: boolean;
  behind: boolean;
} {
  const k = snapshot.islands.findIndex((i) => i.id === to);
  const island = snapshot.islands[k];
  const before = snapshot.islands.find((i) => i.id === island?.basedOn) ?? snapshot.islands[k - 1];
  if (!island) return { lowered: false, behind: false };
  const lowered =
    snapshot.campaign?.stackedStart === 'together'
      ? island.worktree !== 'waiting'
      : (before?.taskPoints.every((tp) => tp.state === 'done' || tp.state === 'doneUnreviewed') ??
        true);
  return { lowered, behind: island.behind };
}

/** Where the camera looks for the whole map: the 480×270 world from the village's side (#124). */
export function overviewCenter(layout: WorldLayout): Point {
  return { x: layout.bounds.x + WORLD.width / 2, y: WORLD.height / 2 };
}
