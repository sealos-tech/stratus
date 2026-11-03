import { defineConfig, devices } from '@playwright/test'

// One worker: the tests share one database and drive simulated time forward.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    {
      command: 'node e2e/mock-server.mjs',
      url: 'http://127.0.0.1:5199/health',
      reuseExistingServer: false,
    },
    {
      command: 'node e2e/seed.mjs && DEV_CRON=0 STATE_DIR=e2e/.state WRANGLER_CONFIG=e2e/wrangler.jsonc PORT=5174 npx vite dev',
      url: 'http://localhost:5174/api/summary',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
