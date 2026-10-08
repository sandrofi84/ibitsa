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
  // be the same copy the SDK uses. The sandbox runtime is ESM-only too and finds its helpers (seccomp,
  // srt-win) in its own package (#200).
  external: ['vscode', '@anthropic-ai/claude-agent-sdk', 'zod', '@anthropic-ai/sandbox-runtime'],
  sourcemap: true,
};
await esbuild.build({
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
});
// The MCP tool bridge ACP agents launch (§11.5, #197): its own small file, run by Node outside the
// extension host, so it must not pull in the adapters (agent-acp is side-effect free, so it doesn't).
await esbuild.build({
  ...common,
  entryPoints: ['src/mcp-bridge.ts'],
  outfile: 'dist/mcp-bridge.cjs',
});
// One hero's sandbox host (§11.5, #200): its own file, run by Node outside the extension host.
await esbuild.build({
  ...common,
  entryPoints: ['src/sandbox-host.ts'],
  outfile: 'dist/sandbox-host.cjs',
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
