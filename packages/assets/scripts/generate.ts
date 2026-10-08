// Regenerates the default pack and the game's bundled engine textures: `pnpm --filter @ibitsa/assets generate`.
// The art in the repo's `art/` folder replaces the code-drawn placeholders piece by piece (spec §9.5).
// Output is committed; the assets tests fail if a regeneration would change it.
import { fileURLToPath } from 'node:url';
import { writeDefaultPack, writeEngineTextures } from '../src/generate.ts';
import { rasterizeSvg } from '../src/svg-rasterizer.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
writeDefaultPack(here('../default-pack/'), {
  art: { dir: here('../../../art/'), rasterize: rasterizeSvg },
});
writeEngineTextures(here('../../game/public/textures/'));
console.log('wrote default-pack/ and ../game/public/textures/');
