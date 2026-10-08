import { Resvg } from '@resvg/resvg-js';
import type { RasterizeSvg } from './art-source.types.ts';

/**
 * The generator's SVG renderer (§9.5, #218): resvg, at the SVG's own size, without system fonts (the
 * art guide allows no text). Only the generate script and the tests import it, never the package's
 * barrel, so resvg stays a development tool and out of the extension.
 */
export const rasterizeSvg: RasterizeSvg = (svg) => {
  const image = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false },
  }).render();
  return { width: image.width, height: image.height, pixels: image.pixels };
};
