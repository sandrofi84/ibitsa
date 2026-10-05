import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/!(adapters)', 'packages/adapters/*'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      // Unit-testable code only. Phaser scenes, the DOM panel and boot are covered by Playwright;
      // the extension by VS Code integration tests.
      include: [
        'packages/core/src/**',
        'packages/protocol/src/**',
        'packages/runtime/src/**',
        'packages/adapters/*/src/**',
        'packages/assets/src/**',
        'packages/game/src/client.ts',
        'packages/game/src/layout.ts',
        'packages/game/src/dev/dev-host.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.types.ts', '**/*.schema.ts', '**/*.d.ts', '**/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Floors at today's numbers, rounded down: coverage may rise, never quietly drop.
      // Raise a floor when a package's coverage goes up.
      thresholds: {
        'packages/core/src/**': { lines: 95, statements: 94, branches: 87, functions: 98 },
        'packages/protocol/src/**': { lines: 100, statements: 100, branches: 100, functions: 100 },
        'packages/adapters/agent-fake/src/**': {
          lines: 96,
          statements: 93,
          branches: 87,
          functions: 86,
        },
        'packages/assets/src/**': { lines: 94, statements: 92, branches: 85, functions: 92 },
        'packages/game/src/**': { lines: 92, statements: 91, branches: 82, functions: 92 },
        'packages/runtime/src/**': { lines: 87, statements: 86, branches: 73, functions: 76 },
      },
    },
  },
});
