import { test, expect } from './fixtures';

/**
 * 08-mtls-client-cert.spec.ts — E2E Scenario 8: mTLS client certificate.
 *
 * This test verifies the mTLS enforcement logic at the API level.
 * Full TLS client-certificate handshake requires nginx Ingress configuration
 * that is not available in the docker-compose test environment, so this test
 * exercises the application-layer check:
 *
 *  1. Creating a user with requires_client_cert=true via admin API.
 *  2. Attempting login without the ssl-client-cert header → 401.
 *  3. Attempting login with a fake ssl-client-cert header (wrong fingerprint) → 401.
 *  4. Admin can manage client certificates via the UI admin page.
 *
 * The "happy path" (cert accepted) is an integration test concern that requires
 * a real TLS setup; it is documented but skipped here.
 *
 * @tags fast
 */

const API_URL   = process.env.API_URL ?? 'http://localhost:8080';
const MTLS_USER = `e2e-mtls-${Date.now()}`;
const MTLS_PASS = 'MtlsUser!1';

test.describe('mTLS client certificate enforcement @fast', () => {
  let mtlsUserID: string;

  test.beforeAll(async ({ request, apiToken }) => {
    const resp = await request.post(`${API_URL}/api/v1/admin/users`, {
      headers: { Authorization: `Bearer ${apiToken}` },
      data: {
        username: MTLS_USER,
        password: MTLS_PASS,
        role: 'read',
        totp_required: false,
        requires_client_cert: true,
      },
    });
    const body = await resp.json();
    mtlsUserID = body.id;
  });

  test.afterAll(async ({ request, apiToken }) => {
    if (mtlsUserID) {
      await request.delete(`${API_URL}/api/v1/admin/users/${mtlsUserID}`, {
        headers: { Authorization: `Bearer ${apiToken}` },
      }).catch(() => {});
    }
  });

  test('login without client cert returns 401 for cert-required user', async ({ request }) => {
    const resp = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { username: MTLS_USER, password: MTLS_PASS },
      // No ssl-client-cert header.
    });
    // Must return 401 (cert required) or 403 (forbidden).
    expect([401, 403]).toContain(resp.status());
  });

  test('login with wrong cert fingerprint returns 401', async ({ request }) => {
    const resp = await request.post(`${API_URL}/api/v1/auth/login`, {
      headers: {
        // Malformed/wrong PEM — server must reject it.
        'ssl-client-cert': 'not-a-real-cert-pem',
      },
      data: { username: MTLS_USER, password: MTLS_PASS },
    });
    expect([400, 401, 403]).toContain(resp.status());
  });

  test('admin client-cert management page is accessible', async ({ adminPage }) => {
    await adminPage.goto('/admin/client-certs');
    await expect(adminPage).toHaveURL(/\/admin\/client-certs/);
    await expect(adminPage.locator('h1, h2').first()).toBeVisible();
  });

  test('admin can see cert-required flag on user', async ({ request, apiToken }) => {
    const resp = await request.get(`${API_URL}/api/v1/admin/users/${mtlsUserID}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const user = await resp.json();
    expect(user.requires_client_cert).toBe(true);
  });
});
