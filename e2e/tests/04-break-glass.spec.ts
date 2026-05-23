import { test, expect } from './fixtures';

/**
 * 04-break-glass.spec.ts — E2E Scenario 6: Break-glass emergency access.
 *
 * Verifies:
 *  1. Logging in with a break-glass account triggers an admin alert (audit log).
 *  2. The audit log records a "auth.break_glass_login" event.
 *  3. The UI shows the break-glass indicator on the session.
 *
 * Note: Creating a break-glass user requires admin API access. The break-glass
 * flag is set on an existing user account.
 *
 * @tags fast
 */

const API_URL     = process.env.API_URL ?? 'http://localhost:8080';
const BG_USER     = `e2e-breakglass-${Date.now()}`;
const BG_PASS     = 'BreakGlass!999';

test.describe('Break-glass access @fast', () => {
  let bgUserID: string;

  test.beforeAll(async ({ request, apiToken }) => {
    // Create a regular user then elevate to break-glass.
    const resp = await request.post(`${API_URL}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        username: BG_USER,
        password: BG_PASS,
        role: 'read',
        totp_required: false,
        is_break_glass: true,
      },
    });
    const body = await resp.json();
    bgUserID = body.id;
  });

  test.afterAll(async ({ request, apiToken }) => {
    if (bgUserID) {
      await request.delete(`${API_URL}/api/v1/admin/users/${bgUserID}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      }).catch(() => {});
    }
  });

  test('break-glass login succeeds and creates audit entry', async ({ request }) => {
    const loginResp = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { username: BG_USER, password: BG_PASS },
    });
    expect(loginResp.ok()).toBeTruthy();
    const session = await loginResp.json();
    expect(session.access_token).toBeTruthy();
  });

  test('break-glass login appears in admin audit log', async ({ request, apiToken }) => {
    // Give the server a moment to write the audit entry.
    await new Promise(r => setTimeout(r, 500));

    const auditResp = await request.get(`${API_URL}/api/v1/admin/audit?limit=20`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const body = await auditResp.json();
    const entries: any[] = body.entries ?? body.logs ?? body ?? [];
    const bgEntry = entries.find(
      (e: any) =>
        e.action === 'auth.break_glass_login' ||
        (e.action?.includes('break') && e.action?.includes('glass'))
    );
    expect(bgEntry).toBeTruthy();
  });

  test('break-glass UI indicator is visible after login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel(/kullanıcı adı/i).fill(BG_USER);
      await page.getByLabel(/parola/i).fill(BG_PASS);
      await page.getByRole('button', { name: /giriş yap/i }).click();

      // Wait for authenticated page.
      await page.waitForURL(/\/inventory|\/setup-totp/, { timeout: 15_000 });

      // A break-glass indicator banner or badge must be visible.
      const indicator = page.locator('[data-testid="break-glass-indicator"]')
        .or(page.getByText(/acil erişim|break.glass/i));
      await expect(indicator.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await context.close();
    }
  });
});
