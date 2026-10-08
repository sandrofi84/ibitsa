/** The size of one frame, in pixels. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * A piece of a pack image that an art source may fill (#218): `source` names the file under `art/`
 * without its extension (`.grid` or `.svg`), drawn at `x`, `y` as `frames` frames side by side.
 */
export interface ArtPiece {
  source: string;
  x: number;
  y: number;
  frame: FrameSize;
  frames: number;
}

/** A pack image (`output`, its path in the pack) and the pieces art sources may replace in it. */
export interface ArtSlot {
  output: string;
  pieces: ArtPiece[];
  /**
   * For an image the pack carries only once its art exists (the hut's scenes, #219): its size. The
   * build makes it, transparent, when a piece has a source; otherwise the pack goes without it.
   */
  optional?: FrameSize;
}

/** Renders an SVG at its own size to premultiplied RGBA pixels (resvg's `render()`). */
export type RasterizeSvg = (svg: string) => { width: number; height: number; pixels: Uint8Array };

/** Where the art's sources are, and how to render the SVGs among them (the generator passes resvg). */
export interface ArtSources {
  dir: string;
  rasterize?: RasterizeSvg;
}
