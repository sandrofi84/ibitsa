import { defineConfig } from 'vitest/config';

const PACKAGES = [
  'packages/core/src/**',
  'packages/protocol/src/**',
  'packages/runtime/src/**',
  'packages/adapters/agent-fake/src/**',
  'packages/adapters/agent-claude-sdk/src/**',
  'packages/assets/src/**',
  'packages/game/src/**',
];

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
        'packages/game/src/action-draft.ts',
        'packages/game/src/at-menu.ts',
        'packages/game/src/command-history.ts',
        'packages/game/src/command-menu.ts',
        'packages/game/src/file-search.ts',
        'packages/game/src/mentions.ts',
        'packages/game/src/heroes.ts',
        'packages/game/src/parties.ts',
        'packages/game/src/slash-menu.ts',
        'packages/game/src/layout.ts',
        'packages/game/src/view-state.ts',
        'packages/game/src/viewport.ts',
        'packages/game/src/camera-director.ts',
        'packages/game/src/hero-selection.ts',
        'packages/game/src/dev/dev-host.ts',
        'packages/game/src/dev/live-dev-host.ts',
        'packages/game/src/dev/fake-host-channel.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.types.ts', '**/*.schema.ts', '**/*.d.ts', '**/index.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // One fixed floor for every package (no ratchet): coverage should sit well above it, and new
      // behaviour still needs real tests. Each package is checked on its own, so none can quietly rot.
      thresholds: Object.fromEntries(
        PACKAGES.map((p) => [p, { lines: 90, statements: 90, functions: 90, branches: 80 }]),
      ),
    },
  },
});
