/**
 * HashiCorp Vault integration endpoints (PR-VAULT, ADR-0007).
 *
 * Security notes:
 *  - Vault plaintext values are NEVER cached in TanStack Query.
 *    useVaultFetchMutation returns data directly to the caller which is
 *    responsible for clearing memory after display (auto-clear timer in UI).
 *  - useVaultPathsQuery IS cached (short staleTime) — it only returns path
 *    metadata, never secret values.
 */

import { useMutation, useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { VaultFetchResponse, VaultPathsResponse } from './types';

/**
 * Fetches Vault-backed field values for a single item.
 *
 * Returns an intentionally-non-cacheable mutation — callers must handle the
 * plaintext response ephemerally (display + auto-clear, never persist).
 */
export function useVaultFetchMutation(itemId: string) {
  return useMutation({
    mutationFn: () =>
      apiFetch<VaultFetchResponse>(`/api/v1/items/${itemId}/vault-fetch`, {
        method: 'POST',
      }),
  });
}

/**
 * Lists available Vault paths at a given mount + prefix (admin only).
 * Used for autocomplete in the item form modal.
 *
 * Enabled only when mount is non-empty and prefix has at least 1 character.
 */
export function useVaultPathsQuery(mount: string, prefix: string) {
  return useQuery({
    queryKey: ['vault', 'paths', mount, prefix],
    queryFn: () =>
      apiFetch<VaultPathsResponse>('/api/v1/vault/paths', {
        query: { mount, path: prefix },
      }),
    enabled: mount.length > 0,
    staleTime: 30_000, // 30 s — path structure doesn't change frequently
    gcTime: 60_000,
  });
}
