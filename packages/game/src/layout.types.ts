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
