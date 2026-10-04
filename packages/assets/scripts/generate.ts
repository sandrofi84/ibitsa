// Regenerates the default pack and the game's bundled engine textures: `pnpm --filter @ibitsa/assets generate`.
// Output is committed; the assets tests fail if a regeneration would change it.
import { fileURLToPath } from 'node:url';
import { writeDefaultPack, writeEngineTextures } from '../src/generate.ts';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
writeDefaultPack(here('../default-pack/'));
writeEngineTextures(here('../../game/public/textures/'));
console.log('wrote default-pack/ and ../game/public/textures/');
