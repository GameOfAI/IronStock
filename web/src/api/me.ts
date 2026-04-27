import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { MyKeypairResponse } from './types';

/**
 * fetchMyKeypair — direct (non-hook) fetch used inside the login flow.
 *
 * We can't useQuery here because the login form needs to chain:
 *   login → fetchMyKeypair → deriveKEK → decryptPrivateKey → setSession.
 * Wrapping in a Mutation keeps it sequential and lets us share the
 * loading state with the caller.
 */
export async function fetchMyKeypair(accessToken: string): Promise<MyKeypairResponse> {
  // The access token isn't yet in storage at this point in login flow,
  // so we set it transiently. The login form passes it via parameter.
  const res = await fetch('/api/v1/users/me/keypair', {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: 'Keypair okunamadı.' }));
    throw new Error(body.message ?? `Keypair fetch: ${res.status}`);
  }
  return (await res.json()) as MyKeypairResponse;
}

/** Mutation wrapper for the same call when used post-login (token in store). */
export function useMyKeypairMutation() {
  return useMutation({
    mutationFn: () => apiFetch<MyKeypairResponse>('/api/v1/users/me/keypair'),
  });
}
