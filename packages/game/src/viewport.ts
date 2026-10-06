import type { Size, Viewport } from './viewport.types';

/**
 * Fills the panel at a whole-number zoom, staying pixel-perfect (#59): the largest zoom at which the
 * whole world still fits, then a canvas of `floor(panel / zoom)` so leftover space shows more of the
 * world instead of black bands. Never below 1.
 */
export function fitViewport({ panel, world }: { panel: Size; world: Size }): Viewport {
  const zoom = Math.max(
    1,
    Math.floor(Math.min(panel.width / world.width, panel.height / world.height)),
  );
  return {
    zoom,
    width: Math.max(1, Math.floor(panel.width / zoom)),
    height: Math.max(1, Math.floor(panel.height / zoom)),
  };
}
