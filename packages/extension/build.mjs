// Bundles the extension (esbuild, CommonJS, `vscode` external) and copies the game build into dist/webview.
import { cpSync, existsSync, rmSync } from 'node:fs';
import * as esbuild from 'esbuild';

const gameDist = new URL('../game/dist/', import.meta.url);
if (!existsSync(gameDist))
  throw new Error('build the game first: pnpm --filter @ibitsa/game build');

rmSync(new URL('./dist/', import.meta.url), { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['vscode'],
  sourcemap: true,
};
await esbuild.build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
});
await esbuild.build({
  ...common,
  entryPoints: ['src/integration/*.it.ts'],
  outdir: 'dist/integration',
  outExtension: { '.js': '.cjs' },
});

cpSync(gameDist, new URL('./dist/webview/', import.meta.url), { recursive: true });
