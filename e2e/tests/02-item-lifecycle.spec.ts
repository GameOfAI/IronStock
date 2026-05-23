import { test, expect, waitForToast, deleteItemViaAPI } from './fixtures';

/**
 * 02-item-lifecycle.spec.ts — E2E Scenario 2: Item create → view → delete.
 *
 * This test avoids E2E encryption share flows (which require two browser
 * contexts with different key material) and focuses on:
 *  1. Creating a new item through the UI form.
 *  2. Verifying the item appears in the inventory list.
 *  3. Clicking through to the item detail page.
 *  4. Deleting the item and confirming it disappears.
 *
 * Note: Field value encryption (E2E) is a client-side operation; this test
 * only exercises the metadata path (name, description, type, tags).
 *
 * @tags fast
 */

const ITEM_NAME = `E2E-Item-${Date.now()}`;

test.describe('Item lifecycle (create → view → delete) @fast', () => {
  let createdItemID: string | undefined;

  test.afterEach(async ({ request, apiToken }) => {
    // Cleanup — delete the item if it was created but the test failed mid-way.
    if (createdItemID) {
      await deleteItemViaAPI(request, apiToken, createdItemID).catch(() => {/* best-effort */});
      createdItemID = undefined;
    }
  });

  test('create new item via UI', async ({ adminPage }) => {
    await adminPage.goto('/inventory');

    // Click the "Yeni Item" or add-item button.
    const newItemBtn = adminPage.getByRole('button', { name: /yeni item|ekle|oluştur/i })
      .or(adminPage.getByRole('link', { name: /yeni item/i }));
    await newItemBtn.first().click();

    // Fill the item name in the create modal/form.
    const nameInput = adminPage.getByLabel(/ad|isim|name/i).first();
    await nameInput.fill(ITEM_NAME);

    // Select item type (default is fine — "Note" / "Not").
    // Submit the form.
    const submitBtn = adminPage.getByRole('button', { name: /oluştur|kaydet|tamam|create|save/i }).last();
    await submitBtn.click();

    // Wait for success feedback (toast or navigation to item detail).
    await adminPage.waitForURL(/\/inventory(\/|$)/, { timeout: 15_000 });

    // Extract the newly created item's ID from the URL if we navigated to it.
    const url = adminPage.url();
    const match = url.match(/\/inventory\/([a-f0-9-]+)/);
    if (match) createdItemID = match[1];
  });

  test('created item appears in the inventory list', async ({ adminPage }) => {
    await adminPage.goto('/inventory');

    // Search for the item.
    const searchInput = adminPage.getByPlaceholder(/ara|search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(ITEM_NAME);
    }

    // The item name must appear somewhere in the inventory.
    await expect(adminPage.getByText(ITEM_NAME).first()).toBeVisible({ timeout: 15_000 });
  });

  test('item detail page is accessible from inventory', async ({ adminPage }) => {
    await adminPage.goto('/inventory');

    // Click the item in the list.
    const itemLink = adminPage.getByText(ITEM_NAME).first();
    await itemLink.click();

    // Should navigate to the item detail page.
    await expect(adminPage).toHaveURL(/\/inventory\//, { timeout: 10_000 });

    // The item name should appear on the detail page.
    await expect(adminPage.getByText(ITEM_NAME).first()).toBeVisible();

    // Extract the ID for cleanup.
    const url = adminPage.url();
    const match = url.match(/\/inventory\/([a-f0-9-]+)/);
    if (match) createdItemID = match[1];
  });

  test('delete item via UI', async ({ adminPage }) => {
    await adminPage.goto('/inventory');

    // Navigate to item detail.
    const itemLink = adminPage.getByText(ITEM_NAME).first();
    await itemLink.click();
    await expect(adminPage).toHaveURL(/\/inventory\//, { timeout: 10_000 });

    // Track item ID for cleanup safety.
    const url = adminPage.url();
    const match = url.match(/\/inventory\/([a-f0-9-]+)/);
    if (match) createdItemID = match[1];

    // Open actions menu and delete.
    const actionsBtn = adminPage.getByRole('button', { name: /sil|eylemler|aksiyon|delete|actions/i }).first();
    await actionsBtn.click();

    const deleteOption = adminPage.getByRole('menuitem', { name: /sil|delete/i })
      .or(adminPage.getByText(/sil/i)).first();
    await deleteOption.click();

    // Confirm deletion dialog.
    const confirmBtn = adminPage.getByRole('button', { name: /onayla|evet|sil|confirm|delete/i }).last();
    await confirmBtn.click();

    // Should redirect to /inventory after deletion.
    await expect(adminPage).toHaveURL(/\/inventory$/, { timeout: 15_000 });

    // Item should not appear in the list anymore.
    const searchInput = adminPage.getByPlaceholder(/ara|search/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill(ITEM_NAME);
    }
    await expect(adminPage.getByText(ITEM_NAME)).toHaveCount(0, { timeout: 5_000 });

    createdItemID = undefined; // cleanup not needed — already deleted
  });
});
