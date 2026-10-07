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
  /** Which row of the map it sits on (#124). */
  row: 'top' | 'bottom';
  taskPoints: { id: string; x: number; y: number }[];
}

/** A stacked plan's drawbridge from one island to the next (§7.2, #124): along a row, or up between rows. */
export interface BridgeLayout {
  from: string;
  to: string;
  x: number;
  y: number;
  /** Span across the water, in pixels: a left end, a segment and a right end. */
  length: number;
  vertical: boolean;
}

export interface WorldLayout {
  village: { x: number; y: number; middles: number; hut: Point; door: Point };
  islands: IslandLayout[];
  bridges: BridgeLayout[];
  /** Ibitsa on the horizon (§7.2): in the sea between the rows, at the map's far end (#153). */
  ibitsa: Point;
  /** The part of the map with something on it; at least the 480×270 world (#124). */
  bounds: { x: number; y: number; width: number; height: number };
}

/** Where an island sits, before its task points are laid out. */
export interface Spot {
  x: number;
  y: number;
  row: 'top' | 'bottom';
}

/** Islands placed by index, and which pairs a bridge joins. */
export interface Placement {
  spots: Spot[];
  bridges: { from: number; to: number }[];
}
