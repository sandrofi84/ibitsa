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
  // The Agent SDK is ESM-only and finds its native binary next to its own module (spec §13); zod must
  // be the same copy the SDK uses.
  external: ['vscode', '@anthropic-ai/claude-agent-sdk', 'zod'],
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
// Ibitsa's built-in actions (/test, /tidy, /explain), loaded by hero sessions as a local plugin (#84).
cpSync(new URL('./plugin/', import.meta.url), new URL('./dist/plugin/', import.meta.url), {
  recursive: true,
});
