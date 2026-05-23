import { defineConfig, devices } from '@playwright/test';

/**
 * IronStock Playwright E2E configuration — PR-PROD3.
 *
 * Tests are split into two tiers:
 *  - @fast: smoke tests that finish in < 30 s (authentication, basic CRUD)
 *  - @slow: scenarios that require a running K8s cluster or WebSocket timing
 *
 * The base URL is read from the environment so CI can point at a fresh
 * docker-compose stack and local dev can point at the Vite dev server.
 *
 * CI runs: main branch push + nightly schedule only (not every PR —
 * the test/k8s real cluster fixture is heavy).
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',

  /* Never parallelize — tests share the same DB state in the compose stack. */
  workers: 1,
  fullyParallel: false,

  /* Fail fast: one flaky test in the setup flow poisons the rest. */
  retries: process.env.CI ? 1 : 0,

  /* Reporter. */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ...(process.env.CI ? [['github'] as ['github']] : []),
  ],

  use: {
    /* Default target. Override with BASE_URL env var. */
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',

    /* Capture trace on first retry to diagnose flakiness in CI. */
    trace: 'on-first-retry',

    /* Full-page screenshot on failure. */
    screenshot: 'only-on-failure',

    /* Video recording only in CI. */
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* Never cache browser context between tests — each test gets a fresh page. */
    storageState: undefined,
  },

  projects: [
    /* ── Setup project ─────────────────────────────────────────────────────── */
    {
      name: 'setup',
      testMatch: '**/global-setup.ts',
    },

    /* ── Chromium ──────────────────────────────────────────────────────────── */
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },

    /* ── Firefox ───────────────────────────────────────────────────────────── */
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      dependencies: ['setup'],
      /* Only in CI — Firefox is slower locally. */
      ...(process.env.CI ? {} : { testIgnore: '**/*' }),
    },
  ],

  /* Timeout per test (generous — K8s and WebSocket tests can be slow). */
  timeout: 60_000,

  /* Global timeout for the whole suite. */
  globalTimeout: 30 * 60_000, // 30 minutes

  /* webServer: Playwright can spin up the dev server if not running.
   * In CI the docker-compose stack is already running, so we skip this. */
  ...(process.env.CI
    ? {}
    : {
        webServer: {
          command: 'npm run dev --prefix ../web',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
