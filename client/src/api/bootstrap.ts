/**
 * Bootstrap API — admin panel setup & login (ADR-0010).
 *
 * Client variant: uses the dynamic base URL (connection store / setBaseUrl).
 * Raw fetch (no apiFetch) because no Bearer token is available yet and
 * we must not trigger the refresh interceptor.
 */

import { getBaseUrl } from './client';

export interface BootstrapStatusResponse {
  setup_complete: boolean;
}

export interface BootstrapLoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user_id: string;
  roles: string[];
}

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

function base(): string {
  const url = getBaseUrl();
  if (!url) throw new Error('Sunucu adresi ayarlanmamış. /config ekranına gidin.');
  return `${url}/api/v1/auth/bootstrap`;
}

export async function bootstrapStatus(): Promise<BootstrapStatusResponse> {
  const res = await fetch(`${base()}/status`);
  return handleResponse<BootstrapStatusResponse>(res);
}

export async function bootstrapSetup(
  username: string,
  password: string,
): Promise<BootstrapLoginResponse> {
  const res = await fetch(`${base()}/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<BootstrapLoginResponse>(res);
}

export async function bootstrapLogin(
  username: string,
  password: string,
): Promise<BootstrapLoginResponse> {
  const res = await fetch(`${base()}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return handleResponse<BootstrapLoginResponse>(res);
}
