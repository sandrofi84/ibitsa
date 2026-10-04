import { defineConfig } from '@vscode/test-cli';

const common = {
  version: 'stable',
  mocha: { ui: 'tdd', timeout: 60_000 },
  launchArgs: ['--disable-extensions'],
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
