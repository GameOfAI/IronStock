/**
 * Item endpoints — read-only hooks for PR-W4 (inventory read).
 *
 * Server kontratı:
 *   GET /api/v1/items?folder_id=X[&q=]   — folder_id zorunlu (DOS guard)
 *   GET /api/v1/items/:id                — tek item detail
 *
 * Item value_enc field'ları client-encrypted. PR-W4 metadata + label
 * gösteriyor; decryption PR-W5'te owner_dek_wrapped expose edilince geliyor.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Item, ItemListResponse } from './types';

/**
 * Bir folder'daki item'ları (ve opsiyonel arama sonuçlarını) çeker.
 * folder_id null/undefined ise hiç çağrılmaz — empty state UI'da gösterilir.
 */
export function useItems(folderId: string | null, q?: string) {
  return useQuery({
    queryKey: queryKeys.items.byFolder(folderId ?? '', q),
    queryFn: () =>
      apiFetch<ItemListResponse>('/api/v1/items', {
        query: { folder_id: folderId ?? undefined, q: q || undefined },
      }),
    enabled: folderId !== null && folderId !== '',
  });
}

/**
 * Tek item detayı (fields dahil — value_enc client-encrypted blob'lar).
 */
export function useItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.items.detail(id ?? ''),
    queryFn: () => apiFetch<Item>(`/api/v1/items/${id}`),
    enabled: id !== null && id !== '',
  });
}
