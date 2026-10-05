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
        'packages/game/src/view-state.ts',
        'packages/game/src/dev/dev-host.ts',
        'packages/game/src/dev/live-dev-host.ts',
        'packages/game/src/dev/fake-host-channel.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.types.ts', '**/*.schema.ts', '**/*.d.ts', '**/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // Floors at today's numbers, rounded down: coverage may rise, never quietly drop.
      // Raise a floor when a package's coverage goes up.
      thresholds: {
        'packages/core/src/**': { lines: 95, statements: 95, branches: 88, functions: 100 },
        'packages/protocol/src/**': { lines: 100, statements: 100, branches: 100, functions: 100 },
        'packages/adapters/agent-fake/src/**': {
          lines: 96,
          statements: 93,
          branches: 87,
          functions: 86,
        },
        'packages/adapters/agent-claude-sdk/src/**': {
          lines: 97,
          statements: 95,
          branches: 83,
          functions: 97,
        },
        'packages/assets/src/**': { lines: 94, statements: 92, branches: 85, functions: 92 },
        'packages/game/src/**': { lines: 96, statements: 95, branches: 92, functions: 96 },
        'packages/runtime/src/**': { lines: 91, statements: 90, branches: 80, functions: 83 },
      },
    },
  },
});
