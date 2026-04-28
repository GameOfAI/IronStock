import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Item, ItemCreateRequest, ItemUpdateRequest, ItemListResponse } from './types';

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
