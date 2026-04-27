import { getBaseUrl } from './client';
import type { MyKeypairResponse } from './types';

/**
 * fetchMyKeypair — keypair malzemesini login akışı içinde doğrudan çeker.
 * access token henüz storage'da değil; parametre olarak alınır.
 * Client versiyonu: web'deki path-only fetch'in aksine getBaseUrl() kullanır.
 */
export async function fetchMyKeypair(accessToken: string): Promise<MyKeypairResponse> {
  const res = await fetch(`${getBaseUrl()}/api/v1/users/me/keypair`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Keypair okunamadı.' }));
    throw new Error((body as { message?: string }).message ?? `Keypair fetch: ${res.status}`);
  }
  return (await res.json()) as MyKeypairResponse;
}
