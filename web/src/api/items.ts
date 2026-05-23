/**
 * Item endpoints — read + write hooks (PR-W4 read, PR-W5 write, PR-SEARCH global search).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type {
  Item,
  ItemCreateRequest,
  ItemUpdateRequest,
  ItemListResponse,
  FieldVersionsResponse,
  ShareItemRequest,
  ShareGroupRequest,
  ItemSharesListResponse,
} from './types';

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

export function useCreateItemMutation(_folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ItemCreateRequest) =>
      apiFetch<Item>('/api/v1/items', { method: 'POST', body: req }),
    onSuccess: () => {
      // items.all kullanıyoruz — byFolder(id) ile byFolder(id, '') gibi
      // farklı `q` değerleri içeren cache key'lerin hepsini invalidate eder.
      qc.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}

export function useUpdateItemMutation(id: string, _folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ItemUpdateRequest) =>
      apiFetch<void>(`/api/v1/items/${id}`, { method: 'PUT', body: req }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}

export function useDeleteItemMutation(_folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}

export function useShareItemMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ShareItemRequest) =>
      apiFetch<void>(`/api/v1/items/${itemId}/shares`, { method: 'POST', body: req }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-shares', itemId] }),
  });
}

export function useUnshareItemMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/shares/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-shares', itemId] }),
  });
}

/** PR-GROUP-SHARE: List all user and group shares for an item. */
export function useItemSharesQuery(itemId: string | null) {
  return useQuery({
    queryKey: ['item-shares', itemId],
    queryFn: () => apiFetch<ItemSharesListResponse>(`/api/v1/items/${itemId}/shares`),
    enabled: Boolean(itemId),
    staleTime: 15_000,
  });
}

/** PR-GROUP-SHARE: Share an item with a group (creates item_group_shares + batch member item_shares). */
export function useShareGroupMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ShareGroupRequest) =>
      apiFetch<void>(`/api/v1/items/${itemId}/group-shares`, { method: 'POST', body: req }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-shares', itemId] }),
  });
}

/** PR-GROUP-SHARE: Revoke a group share (soft-revoke item_group_shares row). */
export function useUnshareGroupMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/group-shares/${groupId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-shares', itemId] }),
  });
}

/** PR-N2: Fetch up to 10 previous encrypted values for a field. */
export function useFieldVersionsQuery(itemId: string | null, fieldDefId: number | null) {
  return useQuery({
    queryKey: ['field-versions', itemId, fieldDefId],
    queryFn: () =>
      apiFetch<FieldVersionsResponse>(
        `/api/v1/items/${itemId}/fields/${fieldDefId}/versions`,
      ),
    enabled: itemId !== null && fieldDefId !== null,
    staleTime: 30_000,
  });
}

/**
 * PR-SEARCH: Cross-folder global search.
 * Calls GET /api/v1/items/search?q=<term> (min 2 chars).
 * Returns items from all folders the user can access.
 */
export function useGlobalItemSearch(q: string) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ['items', 'global-search', trimmed],
    queryFn: () =>
      apiFetch<ItemListResponse>('/api/v1/items/search', {
        query: { q: trimmed },
      }),
    enabled: trimmed.length >= 2,
    staleTime: 10_000,
  });
}

/** PR-N1: Record that a credential has been manually rotated. Sets last_rotated_at = now(). */
export function useRecordRotationMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/items/${itemId}/rotate`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.detail(itemId) });
      qc.invalidateQueries({ queryKey: queryKeys.items.all });
    },
  });
}
