import { getBaseUrl, rawFetch } from './client';
import type { MyKeypairResponse } from './types';

// ─── /users/me/keypair ────────────────────────────────────────────────────────

/**
 * fetchMyKeypair — keypair malzemesini login akışı içinde doğrudan çeker.
 * access token henüz storage'da değil; parametre olarak alınır.
 * Client versiyonu: web'deki path-only fetch'in aksine getBaseUrl() kullanır.
 */
export async function fetchMyKeypair(accessToken: string): Promise<MyKeypairResponse> {
  const res = await rawFetch(`${getBaseUrl()}/api/v1/users/me/keypair`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Keypair okunamadı.' }));
    throw new Error((body as { message?: string }).message ?? `Keypair fetch: ${res.status}`);
  }
  return (await res.json()) as MyKeypairResponse;
}

// ─── /users/me ───────────────────────────────────────────────────────────────

export interface MeResponse {
  id: string;
  username: string;
  email: string;
  status: string;
  roles: string[];
  created_at: string;
}

/**
 * fetchMe — profil bilgisini çeker.
 * KeyringBootstrap'ta fresh access token ile kullanılır.
 */
export async function fetchMe(accessToken: string): Promise<MeResponse> {
  const res = await rawFetch(`${getBaseUrl()}/api/v1/users/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Profil okunamadı.' }));
    throw new Error((body as { message?: string }).message ?? `Me fetch: ${res.status}`);
  }
  return (await res.json()) as MeResponse;
}
