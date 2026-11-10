import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

// Opt-in matrix: use installed browsers only; WebKit does not establish Safari support.
export default defineConfig({
  ...base,
  projects: [
    { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    { name: 'edge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
