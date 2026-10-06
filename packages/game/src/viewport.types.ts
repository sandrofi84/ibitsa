export interface Size {
  width: number;
  height: number;
}

/** How the game fills its panel: a whole-number zoom and the canvas size in game pixels. */
export interface Viewport extends Size {
  zoom: number;
}
