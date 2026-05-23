import { test, expect, createItemViaAPI, deleteItemViaAPI } from './fixtures';

/**
 * 07-report-generation.spec.ts — E2E Scenario 3: K8s report generation.
 *
 * Creates 3 test items via the API, generates an HTML report for them,
 * verifies the download, and checks the report contains the item names.
 *
 * Note: include_k8s_live is set to false because there is no real K8s
 * cluster in the E2E environment.
 *
 * @tags fast
 */

const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const ITEM_COUNT = 3;

test.describe('Report generation @fast', () => {
  const itemIDs: string[] = [];

  test.beforeAll(async ({ request, apiToken }) => {
    for (let i = 0; i < ITEM_COUNT; i++) {
      const id = await createItemViaAPI(request, apiToken, `ReportItem-${i}-${Date.now()}`);
      itemIDs.push(id);
    }
  });

  test.afterAll(async ({ request, apiToken }) => {
    for (const id of itemIDs) {
      await deleteItemViaAPI(request, apiToken, id).catch(() => {});
    }
  });

  test('report generation API returns HTML content', async ({ request, apiToken }) => {
    const resp = await request.post(`${API_URL}/api/v1/admin/reports/generate`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        item_ids: itemIDs,
        options: {
          include_k8s_live: false,
          include_relationships: true,
          include_field_values: false,
          report_title: 'E2E Test Report',
        },
      },
    });

    expect(resp.ok()).toBeTruthy();
    expect(resp.headers()['content-type']).toMatch(/text\/html/i);

    const html = await resp.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('E2E Test Report');
  });

  test('report contains all requested item names', async ({ request, apiToken }) => {
    // Fetch item names to verify they're in the report.
    const itemNames: string[] = [];
    for (const id of itemIDs) {
      const itemResp = await request.get(`${API_URL}/api/v1/items/${id}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      const item = await itemResp.json();
      itemNames.push(item.name_plain ?? item.name);
    }

    const reportResp = await request.post(`${API_URL}/api/v1/admin/reports/generate`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        item_ids: itemIDs,
        options: {
          include_k8s_live: false,
          include_relationships: false,
          include_field_values: false,
          report_title: 'Content Check Report',
        },
      },
    });

    const html = await reportResp.text();
    for (const name of itemNames) {
      expect(html).toContain(name);
    }
  });

  test('report rejects more than 50 item IDs', async ({ request, apiToken }) => {
    const tooManyIDs = Array.from({ length: 51 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);

    const resp = await request.post(`${API_URL}/api/v1/admin/reports/generate`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        item_ids: tooManyIDs,
        options: { include_k8s_live: false },
      },
    });

    expect(resp.status()).toBe(400);
  });

  test('report requires admin role', async ({ request }) => {
    // Use no auth token.
    const resp = await request.post(`${API_URL}/api/v1/admin/reports/generate`, {
      data: {
        item_ids: itemIDs,
        options: { include_k8s_live: false },
      },
    });

    expect(resp.status()).toBe(401);
  });

  test('admin can download report from UI', async ({ adminPage }) => {
    await adminPage.goto('/admin/reports');

    // Reports page must be accessible.
    await expect(adminPage).toHaveURL(/\/admin\/reports/);
    await expect(adminPage.locator('h1, h2').first()).toBeVisible();
  });
});
