/**
 * Catalog endpoints — read-only lookup tables.
 *
 * Field definitions ve item types nadiren değişir → `staleTime: Infinity`
 * ile session boyunca cache. Logout'ta queryClient zaten temizlenir.
 */

import { useQueries, useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { FieldDefinitionsResponse, ItemTypesResponse, UserPublicKeyResponse } from './types';

/**
 * 30 seed field tanımı — pagination yok (server full liste döndürüyor).
 */
export function useFieldDefinitions() {
  return useQuery({
    queryKey: queryKeys.catalog.fieldDefinitions,
    queryFn: () => apiFetch<FieldDefinitionsResponse>('/api/v1/field-definitions'),
    staleTime: Infinity,
  });
}

/**
 * 8 seed item tipi.
 */
export function useItemTypes() {
  return useQuery({
    queryKey: queryKeys.catalog.itemTypes,
    queryFn: () => apiFetch<ItemTypesResponse>('/api/v1/item-types'),
    staleTime: Infinity,
  });
}

/** Kullanıcının X25519 public key'i — sharing için DEK wrap. */
export function useUserPublicKey(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.catalog.userPublicKey(userId ?? ''),
    queryFn: () => apiFetch<UserPublicKeyResponse>(`/api/v1/users/${userId}/public-key`),
    enabled: userId !== null && userId !== '',
    staleTime: Infinity,
  });
}

/**
 * PR-GROUP-SHARE: Batch fetch public keys for a list of user IDs.
 * Returns a map of userId → base64 public key string, or undefined while loading.
 * All queries are parallel (useQueries). Stale forever — keypairs rarely change.
 */
export function useUserPublicKeys(userIds: string[]): {
  data: Record<string, string> | undefined;
  isLoading: boolean;
} {
  const results = useQueries({
    queries: userIds.map((id) => ({
      queryKey: queryKeys.catalog.userPublicKey(id),
      queryFn: () => apiFetch<UserPublicKeyResponse>(`/api/v1/users/${id}/public-key`),
      staleTime: Infinity,
      enabled: Boolean(id),
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  const allLoaded = results.length > 0 && results.every((r) => r.isSuccess);

  if (!allLoaded || userIds.length === 0) return { data: undefined, isLoading };

  const map: Record<string, string> = {};
  for (let i = 0; i < userIds.length; i++) {
    const d = results[i].data;
    if (d) map[userIds[i]] = d.public_key;
  }
  return { data: map, isLoading: false };
}
