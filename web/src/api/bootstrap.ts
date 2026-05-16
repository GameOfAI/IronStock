/**
 * Bootstrap API — admin panel setup & login (ADR-0010).
 *
 * Uses raw fetch (not apiFetch) because no Bearer token is available yet
 * and we must not trigger the apiFetch refresh interceptor.
 */

const BASE = '/api/v1/auth/bootstrap';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BootstrapStatusResponse {
  /** true = admin already exists → show /admin-login */
  setup_complete: boolean;
}

export interface BootstrapLoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user_id: string;
  roles: string[];
  must_change_password?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body.message) message = body.message;
  } catch {
    // ignore parse failure
  }
  throw new Error(message);
}

// ── API calls ────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/auth/bootstrap/status
 * Returns whether the first admin account has been created.
 * Public endpoint — no auth required.
 */
export async function bootstrapStatus(): Promise<BootstrapStatusResponse> {
  const res = await fetch(`${BASE}/status`);
  return handleResponse<BootstrapStatusResponse>(res);
}

/**
 * POST /api/v1/auth/bootstrap/setup
 * Creates the first (and only) admin account.
 * Fails with 409 if an admin already exists.
 * Returns JWT on 201 (auto-login).
 */
export async function bootstrapSetup(
  username: string,
  password: string,
): Promise<BootstrapLoginResponse> {
  const res = await fetch(`${BASE}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<BootstrapLoginResponse>(res);
}

/**
 * POST /api/v1/auth/bootstrap/login
 * TOTP-free login for the existing admin.
 */
export async function bootstrapLogin(
  username: string,
  password: string,
): Promise<BootstrapLoginResponse> {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<BootstrapLoginResponse>(res);
}
