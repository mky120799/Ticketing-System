import { defineConfig } from '@playwright/test';

// Runs against the local stack: docker compose --profile app up -d  (staff console :5173, portal :5174, API :3000, Keycloak :8080)
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { headless: true, viewport: { width: 1366, height: 900 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  globalSetup: './global-setup.ts'
});
