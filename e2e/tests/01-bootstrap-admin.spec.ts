import { test, expect } from './fixtures';

/**
 * 01-bootstrap-admin.spec.ts — E2E Scenario 1: Bootstrap admin flow.
 *
 * Verifies:
 *  1. Unauthenticated access to /inventory redirects to /login.
 *  2. Login with valid credentials redirects to /inventory.
 *  3. The authenticated nav shows the admin's username.
 *  4. Logout returns to /login with a clean session.
 *
 * Depends on: global-setup.ts having already bootstrapped and saved the
 * admin session. This test re-validates the session is usable.
 *
 * @tags fast
 */

test.describe('Bootstrap admin flow @fast', () => {
  test('unauthenticated request redirects to login', async ({ page }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login/);
  });

  test('admin login succeeds and redirects to /inventory', async ({ adminPage }) => {
    await adminPage.goto('/inventory');
    await expect(adminPage).toHaveURL(/\/inventory/);
    // The inventory page must have a meaningful heading.
    await expect(
      adminPage.getByRole('heading').or(adminPage.locator('h1, h2')).first()
    ).toBeVisible();
  });

  test('authenticated nav shows admin username or avatar', async ({ adminPage }) => {
    await adminPage.goto('/inventory');
    // Some form of the admin username must appear in the shell (nav, avatar, user menu).
    const usernameIndicator = adminPage.locator(
      '[data-testid="user-menu"], [aria-label="Kullanıcı menüsü"], [data-user-name]'
    ).or(adminPage.getByText(/e2e-admin/i));
    await expect(usernameIndicator.first()).toBeVisible({ timeout: 10_000 });
  });

  test('logout clears session and redirects to /login', async ({ adminPage }) => {
    await adminPage.goto('/inventory');

    // Open user menu and click logout (Turkish UI).
    const userMenu = adminPage.locator('[data-testid="user-menu"]')
      .or(adminPage.getByRole('button', { name: /e2e-admin|kullanıcı/i }));
    await userMenu.first().click();

    const logoutBtn = adminPage.getByRole('menuitem', { name: /çıkış/i })
      .or(adminPage.getByText(/çıkış yap/i));
    await logoutBtn.first().click();

    await expect(adminPage).toHaveURL(/\/login/, { timeout: 10_000 });

    // Navigating back to /inventory after logout must redirect to login again.
    await adminPage.goto('/inventory');
    await expect(adminPage).toHaveURL(/\/login/);
  });
});
