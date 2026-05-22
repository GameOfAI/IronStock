import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Item, ItemCreateRequest, ItemUpdateRequest, ItemListResponse, FieldVersionsResponse } from './types';

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

export function useItem(id: string | null) {
  return useQuery({
    queryKey: queryKeys.items.detail(id ?? ''),
    queryFn: () => apiFetch<Item>(`/api/v1/items/${id}`),
    enabled: id !== null && id !== '',
  });
}

export function useCreateItemMutation(folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ItemCreateRequest) =>
      apiFetch<Item>('/api/v1/items', { method: 'POST', body: req }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.byFolder(folderId) });
    },
  });
}

export function useUpdateItemMutation(id: string, folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: ItemUpdateRequest) =>
      apiFetch<void>(`/api/v1/items/${id}`, { method: 'PUT', body: req }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.items.byFolder(folderId) });
    },
  });
}

export function useDeleteItemMutation(folderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/api/v1/items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.items.byFolder(folderId) });
    },
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

/** PR-N1: Record that a credential has been manually rotated. Sets last_rotated_at = now(). */
/** PR-SEARCH: Cross-folder global search. Min 2 chars. */
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
