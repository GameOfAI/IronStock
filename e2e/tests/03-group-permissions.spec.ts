import { test, expect, createUserViaAPI, loginAs } from './fixtures';

/**
 * 03-group-permissions.spec.ts — E2E Scenario 5: Group permissions.
 *
 * Creates a group, assigns a folder permission to it, adds a user to the
 * group, and verifies the user can access the folder through their group
 * membership.
 *
 * Flow (all via API to keep test fast, UI assertions for verification):
 *  1. Admin creates a folder.
 *  2. Admin creates a group and adds a read-only user.
 *  3. Admin grants the group read access to the folder.
 *  4. The read user can see the folder in their inventory.
 *  5. Admin revokes the group permission.
 *  6. The read user can no longer see the folder.
 *
 * @tags fast
 */

const GROUP_NAME  = `E2E-Group-${Date.now()}`;
const FOLDER_NAME = `E2E-Folder-${Date.now()}`;
const READ_USER   = `e2e-reader-${Date.now()}`;
const READ_PASS   = 'E2eReader!1';

const API_URL = process.env.API_URL ?? 'http://localhost:8080';

test.describe('Group permissions @fast', () => {
  let folderID: string;
  let groupID: string;
  let userID: string;

  test.beforeAll(async ({ request, apiToken }) => {
    // Create folder.
    const folderResp = await request.post(`${API_URL}/api/v1/folders`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: { name: FOLDER_NAME, parent_id: null },
    });
    const folder = await folderResp.json();
    folderID = folder.id;

    // Create read user.
    userID = await createUserViaAPI(request, apiToken, READ_USER, READ_PASS);

    // Create group.
    const groupResp = await request.post(`${API_URL}/api/v1/admin/groups`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: { name: GROUP_NAME },
    });
    const group = await groupResp.json();
    groupID = group.id;

    // Add user to group.
    await request.post(`${API_URL}/api/v1/admin/groups/${groupID}/members`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: { user_id: userID },
    });
  });

  test.afterAll(async ({ request, apiToken }) => {
    // Best-effort cleanup.
    if (groupID)  await request.delete(`${API_URL}/api/v1/admin/groups/${groupID}`, { headers: { Authorization: `Bearer ${apiToken}` } }).catch(() => {});
    if (folderID) await request.delete(`${API_URL}/api/v1/folders/${folderID}`,      { headers: { Authorization: `Bearer ${apiToken}` } }).catch(() => {});
    if (userID)   await request.delete(`${API_URL}/api/v1/admin/users/${userID}`,    { headers: { Authorization: `Bearer ${apiToken}` } }).catch(() => {});
  });

  test('read user cannot see folder before group permission is granted', async ({ request }) => {
    const readerToken = await loginAs(request, READ_USER, READ_PASS);
    const resp = await request.get(`${API_URL}/api/v1/folders`, {
      headers: { Authorization: `Bearer ${readerToken}` },
    });
    const folders = await resp.json();
    const folderIDs: string[] = (folders.folders ?? folders).map((f: any) => f.id);
    expect(folderIDs).not.toContain(folderID);
  });

  test('grant group read permission on folder', async ({ request, apiToken }) => {
    const resp = await request.post(`${API_URL}/api/v1/folders/${folderID}/group-permissions`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: { group_id: groupID, permission: 'read' },
    });
    expect(resp.status()).toBeLessThan(300);
  });

  test('read user can see folder after group permission is granted', async ({ request }) => {
    const readerToken = await loginAs(request, READ_USER, READ_PASS);
    const resp = await request.get(`${API_URL}/api/v1/folders`, {
      headers: { Authorization: `Bearer ${readerToken}` },
    });
    const folders = await resp.json();
    const folderIDs: string[] = (folders.folders ?? folders).map((f: any) => f.id);
    expect(folderIDs).toContain(folderID);
  });

  test('admin removes group from folder — user loses access', async ({ request, apiToken }) => {
    // Remove group permission.
    await request.delete(`${API_URL}/api/v1/folders/${folderID}/group-permissions/${groupID}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });

    const readerToken = await loginAs(request, READ_USER, READ_PASS);
    const resp = await request.get(`${API_URL}/api/v1/folders`, {
      headers: { Authorization: `Bearer ${readerToken}` },
    });
    const folders = await resp.json();
    const folderIDs: string[] = (folders.folders ?? folders).map((f: any) => f.id);
    expect(folderIDs).not.toContain(folderID);
  });
});
