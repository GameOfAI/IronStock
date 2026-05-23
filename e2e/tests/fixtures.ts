import { test as base, expect, APIRequestContext } from '@playwright/test';
import { ADMIN_STORAGE_STATE } from './global-setup';

/**
 * fixtures.ts — Shared Playwright fixtures and helpers for IronStock E2E tests.
 *
 * Exports:
 *  - `test`: extended base test with `adminPage` (pre-authenticated) and
 *    `apiClient` (bare request context with admin token).
 *  - `helpers`: utility functions used across multiple test files.
 */

export type TestFixtures = {
  /** A page already authenticated as the E2E admin. */
  adminPage: ReturnType<typeof base['extend']> extends infer T ? any : never;
  /** Direct API client (no browser) with admin credentials. */
  apiToken: string;
};

const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'e2e-admin';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2eTestP@ss1';

export const test = base.extend<{
  adminPage: ReturnType<typeof base>['context'] extends infer C ? any : never;
  apiToken: string;
}>({
  // Pre-authenticated browser context (reads saved storage state).
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ADMIN_STORAGE_STATE,
    });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },

  // API token extracted from the saved session for direct API calls.
  apiToken: async ({ request }, use) => {
    const loginResp = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    const body = await loginResp.json();
    await use(body.access_token ?? '');
  },
});

export { expect };

// ── Typed helper functions ────────────────────────────────────────────────────

/** Wait for a toast/notification to appear and disappear. */
export async function waitForToast(page: any, textPattern: string | RegExp): Promise<void> {
  const toast = page.locator('[role="status"], [data-sonner-toast]').filter({ hasText: textPattern });
  await toast.first().waitFor({ state: 'visible', timeout: 10_000 });
}

/** Create an item via the API (avoids UI for non-UI-focused tests). */
export async function createItemViaAPI(
  request: APIRequestContext,
  token: string,
  name: string,
  folderID?: string,
): Promise<string> {
  const resp = await request.post(`${API_URL}/api/v1/items`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name_plain: name,
      item_type_key: 'note',
      folder_id: folderID ?? null,
      description: `E2E test item: ${name}`,
    },
  });
  const body = await resp.json();
  return body.id;
}

/** Create a regular (non-admin) user via the API. */
export async function createUserViaAPI(
  request: APIRequestContext,
  token: string,
  username: string,
  password: string,
): Promise<string> {
  const resp = await request.post(`${API_URL}/api/v1/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { username, password, role: 'read', totp_required: false },
  });
  const body = await resp.json();
  return body.id;
}

/** Log in as a different user and return their access token. */
export async function loginAs(
  request: APIRequestContext,
  username: string,
  password: string,
): Promise<string> {
  const resp = await request.post(`${API_URL}/api/v1/auth/login`, {
    data: { username, password },
  });
  const body = await resp.json();
  return body.access_token ?? '';
}

/** Delete an item via the API (cleanup helper). */
export async function deleteItemViaAPI(
  request: APIRequestContext,
  token: string,
  itemID: string,
): Promise<void> {
  await request.delete(`${API_URL}/api/v1/items/${itemID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}
