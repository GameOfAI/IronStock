/**
 * Catalog endpoints — read-only lookup tables.
 *
 * Field definitions ve item types nadiren değişir → `staleTime: Infinity`
 * ile session boyunca cache. Logout'ta queryClient zaten temizlenir.
 */

import { useQuery } from '@tanstack/react-query';
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
