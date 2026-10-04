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
]);
