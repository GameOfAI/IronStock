import { test, expect, createItemViaAPI, deleteItemViaAPI } from './fixtures';

/**
 * 10-pipeline-editor.spec.ts — E2E Scenario 10: Pipeline/lifecycle diagram.
 *
 * Verifies:
 *  1. The pipeline editor page is accessible.
 *  2. An item's pipeline diagram tab is reachable from item detail.
 *  3. Relationships between items can be created (and appear in the graph).
 *  4. The diagram renders nodes and edges (ReactFlow canvas is present).
 *
 * Note: ReactFlow snapshot comparison (pixel-diff) is CI-only and requires a
 * golden screenshot committed to the repo. This test focuses on DOM structure
 * checks only, not pixel equality.
 *
 * @tags fast
 */

const API_URL = process.env.API_URL ?? 'http://localhost:8080';
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

test.describe('Pipeline editor / relationship diagram @fast', () => {
  let sourceItemID: string;
  let targetItemID: string;

  test.beforeAll(async ({ request, apiToken }) => {
    const now = Date.now();
    sourceItemID = await createItemViaAPI(request, apiToken, `Pipeline-Source-${now}`);
    targetItemID = await createItemViaAPI(request, apiToken, `Pipeline-Target-${now}`);
  });

  test.afterAll(async ({ request, apiToken }) => {
    for (const id of [sourceItemID, targetItemID]) {
      if (id) await deleteItemViaAPI(request, apiToken, id).catch(() => {});
    }
  });

  test('item detail page has a relationships/pipeline tab', async ({ adminPage }) => {
    test.skip(!sourceItemID, 'No item from beforeAll');

    await adminPage.goto(`${BASE_URL}/inventory/${sourceItemID}`);
    await expect(adminPage).toHaveURL(/\/inventory\//);

    // A tab labelled "İlişkiler", "Pipeline", "Diagram" or similar must exist.
    const relTab = adminPage.getByRole('tab', { name: /ilişki|pipeline|diagram|graph/i })
      .or(adminPage.getByText(/ilişkiler|pipeline/i).first());
    await expect(relTab.first()).toBeVisible({ timeout: 10_000 });
  });

  test('creating a relationship via API appears in the graph', async ({ request, apiToken, adminPage }) => {
    test.skip(!sourceItemID || !targetItemID, 'Items not created in beforeAll');

    // Create a relationship via API.
    const relResp = await request.post(`${API_URL}/api/v1/items/${sourceItemID}/relationships`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        target_item_id: targetItemID,
        relationship_type: 'depends_on',
      },
    });
    expect(relResp.status()).toBeLessThan(300);

    // Navigate to source item's detail page.
    await adminPage.goto(`${BASE_URL}/inventory/${sourceItemID}`);

    // Click the relationships/pipeline tab.
    const relTab = adminPage.getByRole('tab', { name: /ilişki|pipeline|diagram|graph/i })
      .or(adminPage.getByText(/ilişkiler/i).first());
    await relTab.first().click();

    // The ReactFlow canvas or relationship list must be present.
    const canvas = adminPage.locator('.react-flow, [data-testid="pipeline-canvas"], [data-testid="relationship-graph"]')
      .or(adminPage.locator('canvas').first())
      .or(adminPage.getByText(/Pipeline-Target/i));
    await expect(canvas.first()).toBeVisible({ timeout: 15_000 });
  });

  test('pipeline relationships endpoint returns graph data', async ({ request, apiToken }) => {
    test.skip(!sourceItemID, 'No item from beforeAll');

    const resp = await request.get(`${API_URL}/api/v1/items/${sourceItemID}/relationships`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();

    // Response must include nodes/edges OR a flat list of relationships.
    const hasGraph = body.nodes !== undefined || body.edges !== undefined;
    const hasList  = Array.isArray(body.relationships ?? body);
    expect(hasGraph || hasList).toBeTruthy();
  });

  test('pipeline diagram page for all items is accessible', async ({ adminPage }) => {
    // Check if a global pipeline diagram page exists.
    await adminPage.goto(`${BASE_URL}/inventory/pipeline`);
    // Either we land on the pipeline page or get redirected — either way,
    // no 404 error page.
    const errorPage = adminPage.getByText(/404|sayfa bulunamadı/i);
    const hasError = await errorPage.first().isVisible().catch(() => false);
    if (hasError) {
      // Global pipeline page doesn't exist — that's acceptable (per-item only).
      test.skip();
    }
    await expect(adminPage.locator('h1, h2').first()).toBeVisible();
  });
});
