/**
 * Lifecycle stage endpoints (PR-F5c).
 *
 * GET  /api/v1/lifecycle-stages              — catalog (fixed 8 stages)
 * GET  /api/v1/items/{id}/lifecycle-stages   — item's assigned stages
 * POST /api/v1/items/{id}/lifecycle-stages   — set item's stages (upsert)
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  LifecycleStagesResponse,
  ItemLifecycleStagesResponse,
  SetItemLifecycleStagesRequest,
} from './types';

// --- Query keys ---

export const lifecycleStagesKey = ['lifecycle-stages'] as const;
export const itemLifecycleStagesKey = (itemId: string) =>
  ['items', itemId, 'lifecycle-stages'] as const;

// --- Queries ---

/** Fetch the fixed catalog of lifecycle stages. Rarely changes — long stale. */
export function useLifecycleStagesQuery() {
  return useQuery({
    queryKey: lifecycleStagesKey,
    queryFn: () =>
      apiFetch<LifecycleStagesResponse>('/api/v1/lifecycle-stages', { method: 'GET' }),
    staleTime: 5 * 60_000, // 5 minutes
  });
}

/** Fetch lifecycle stage IDs assigned to a specific item. */
export function useItemLifecycleStagesQuery(itemId: string | null) {
  return useQuery({
    queryKey: itemLifecycleStagesKey(itemId ?? ''),
    queryFn: () =>
      apiFetch<ItemLifecycleStagesResponse>(
        `/api/v1/items/${itemId}/lifecycle-stages`,
        { method: 'GET' },
      ),
    enabled: !!itemId,
    staleTime: 30_000,
  });
}

// --- Mutations ---

/** Set (replace) lifecycle stages for an item. */
export function useSetItemLifecycleStagesMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SetItemLifecycleStagesRequest) =>
      apiFetch<ItemLifecycleStagesResponse>(
        `/api/v1/items/${itemId}/lifecycle-stages`,
        {
          method: 'POST',
          body: req,
        },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: itemLifecycleStagesKey(itemId) });
    },
  });
}
