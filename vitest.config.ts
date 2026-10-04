import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/!(adapters)', 'packages/adapters/*'],
    passWithNoTests: true,
  },
});
