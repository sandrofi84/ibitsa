import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@vscode/test-cli';

// --enable-unsafe-swiftshader: CI runners have no GPU; lets Chromium fall back to software WebGL.
const common = {
  version: 'stable',
  mocha: { ui: 'tdd', timeout: 60_000 },
  launchArgs: ['--disable-extensions', '--enable-unsafe-swiftshader'],
};

export default defineConfig([
  { ...common, label: 'engine-check', files: 'dist/integration/engine-check.it.cjs' },
  {
    ...common,
    label: 'no-webgl',
    files: 'dist/integration/no-webgl.it.cjs',
    env: { IBITSA_FORCE_NO_WEBGL: '1' },
  },
  {
    ...common,
    label: 'wiring',
    files: 'dist/integration/wiring.it.cjs',
    // A folder is needed for workspace storage, which holds the campaign logs. It goes first: VS Code
    // reads an unknown flag like --enable-unsafe-swiftshader as taking the next argument as its value,
    // so test-cli's `workspaceFolder` (appended last) would be swallowed.
    launchArgs: [mkdtempSync(join(tmpdir(), 'ibitsa-workspace-')), ...common.launchArgs],
    env: { IBITSA_TESTING: '1' },
  },
]);
