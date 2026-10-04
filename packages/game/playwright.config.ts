import { defineConfig, devices } from '@playwright/test';

// End-to-end tests against the built standalone game (spec §13), with WebGL via SwiftShader.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4320',
    viewport: { width: 1000, height: 620 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'vite build --mode standalone && vite preview --mode standalone --port 4320 --strictPort',
    url: 'http://localhost:4320',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
