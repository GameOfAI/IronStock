/**
 * Item annotation endpoints (PR-DP01).
 * Backstage metadata.annotations karşılığı — freeform key-value item metadata.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  ItemAnnotation,
  ItemAnnotationsResponse,
  UpsertAnnotationRequest,
} from './types';

const annotationsKey = (itemId: string) => ['item-annotations', itemId] as const;

export function useItemAnnotationsQuery(itemId: string | null) {
  return useQuery({
    queryKey: annotationsKey(itemId ?? ''),
    queryFn: () =>
      apiFetch<ItemAnnotationsResponse>(`/api/v1/items/${itemId}/annotations`),
    enabled: itemId !== null && itemId !== '',
    staleTime: 30_000,
  });
}

export function useUpsertAnnotationMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiFetch<ItemAnnotation>(
        `/api/v1/items/${itemId}/annotations/${encodeURIComponent(key)}`,
        { method: 'PUT', body: { value } satisfies UpsertAnnotationRequest },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: annotationsKey(itemId) }),
  });
}

export function useDeleteAnnotationMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) =>
      apiFetch<void>(
        `/api/v1/items/${itemId}/annotations/${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: annotationsKey(itemId) }),
  });
}
