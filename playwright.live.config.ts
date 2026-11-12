import { defineConfig, devices } from '@playwright/test';

// Provision isolated services separately. Never start or proxy to ordinary user services.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'live-conversion-matrix.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
});
