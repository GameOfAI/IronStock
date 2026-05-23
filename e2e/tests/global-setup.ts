import { test as setup, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * global-setup.ts — Playwright global setup (runs once before all test projects).
 *
 * Responsibilities:
 *  1. Wait for the API health endpoint to be reachable.
 *  2. Bootstrap the admin account if this is a fresh DB (first-time setup).
 *  3. Save the authenticated admin session to a file so test specs can reuse it
 *     without re-logging-in (faster tests, fewer round-trips).
 *
 * The bootstrap step calls POST /api/v1/auth/bootstrap (available only once,
 * before any admin exists) with the credentials from environment variables:
 *   E2E_ADMIN_USERNAME  (default: e2e-admin)
 *   E2E_ADMIN_PASSWORD  (default: E2eTestP@ss1)
 *
 * SECURITY NOTE: These credentials are only for the ephemeral docker-compose
 * test environment and must never be used in production.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const API_URL  = process.env.API_URL  ?? 'http://localhost:8080';

const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2eTestP@ss1';

export const ADMIN_STORAGE_STATE = path.join(__dirname, '..', '.auth', 'admin.json');

setup('authenticate as admin', async ({ page, request }) => {
  // ── 1. Wait for API to be healthy ─────────────────────────────────────────
  const maxWait = 30_000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const resp = await request.get(`${API_URL}/healthz`);
      if (resp.ok()) break;
    } catch {
      await page.waitForTimeout(1_000);
    }
  }

  // ── 2. Bootstrap admin (safe to call even if already bootstrapped) ─────────
  const bootstrap = await request.post(`${API_URL}/api/v1/auth/bootstrap`, {
    data: {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    },
  });
  // 200 OK (created) or 409 Conflict (already bootstrapped) are both fine.
  const bootstrapStatus = bootstrap.status();
  if (bootstrapStatus !== 200 && bootstrapStatus !== 201 && bootstrapStatus !== 409) {
    throw new Error(`Bootstrap failed with status ${bootstrapStatus}: ${await bootstrap.text()}`);
  }

  // ── 3. Log in and capture the access token ─────────────────────────────────
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/kullanıcı adı/i).fill(ADMIN_USERNAME);
  await page.getByLabel(/parola/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /giriş yap/i }).click();

  // Wait for redirect to /inventory (successful login) or TOTP setup gate.
  await page.waitForURL(/\/(inventory|setup-totp)/, { timeout: 15_000 });

  // ── 4. Handle forced TOTP setup gate (first-time admin) ───────────────────
  if (page.url().includes('setup-totp')) {
    // Skip TOTP setup in E2E environment by using the API directly to disable
    // the TOTP requirement for the e2e-admin user (admin privilege).
    // First we need to get the token from the login response — but since we
    // went through the UI, we read it from localStorage.
    const accessToken = await page.evaluate(() =>
      localStorage.getItem('ironstock_access_token')
    );
    if (accessToken) {
      await request.patch(`${API_URL}/api/v1/admin/users/me/totp-required`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        data: { totp_required: false },
      });
      // Re-login to get a clean session without the TOTP gate.
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel(/kullanıcı adı/i).fill(ADMIN_USERNAME);
      await page.getByLabel(/parola/i).fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: /giriş yap/i }).click();
      await page.waitForURL('/inventory', { timeout: 15_000 });
    }
  }

  // ── 5. Persist the authenticated browser storage state ────────────────────
  const authDir = path.dirname(ADMIN_STORAGE_STATE);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });

  console.log('[setup] Admin session saved to', ADMIN_STORAGE_STATE);
});
