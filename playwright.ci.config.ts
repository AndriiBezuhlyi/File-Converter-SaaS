import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  // Live services are provisioned explicitly by the workflow_dispatch job.
  testIgnore: ['**/live-*.spec.ts', '**/*.live.spec.ts'],
});
