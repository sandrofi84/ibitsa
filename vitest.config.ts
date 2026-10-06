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
        'packages/game/src/at-menu.ts',
        'packages/game/src/command-history.ts',
        'packages/game/src/command-menu.ts',
        'packages/game/src/file-search.ts',
        'packages/game/src/mentions.ts',
        'packages/game/src/heroes.ts',
        'packages/game/src/layout.ts',
        'packages/game/src/view-state.ts',
        'packages/game/src/viewport.ts',
        'packages/game/src/camera-director.ts',
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
        'packages/core/src/**': { lines: 96, statements: 96, branches: 91, functions: 100 },
        'packages/protocol/src/**': { lines: 100, statements: 100, branches: 100, functions: 100 },
        'packages/adapters/agent-fake/src/**': {
          lines: 96,
          statements: 93,
          branches: 87,
          functions: 86,
        },
        'packages/adapters/agent-claude-sdk/src/**': {
          lines: 97,
          statements: 96,
          branches: 85,
          functions: 97,
        },
        'packages/assets/src/**': { lines: 94, statements: 92, branches: 85, functions: 93 },
        'packages/game/src/**': { lines: 98, statements: 98, branches: 97, functions: 98 },
        'packages/runtime/src/**': { lines: 92, statements: 91, branches: 83, functions: 85 },
      },
    },
  },
});
