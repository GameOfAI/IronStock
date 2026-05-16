/**
 * Graph / Pipeline relationship endpoints (PR-F5a).
 *
 * GET    /api/v1/graph                                      — nodes + edges
 * POST   /api/v1/items/{id}/relationships                   — add edge
 * DELETE /api/v1/items/{id}/relationships/{target}/{type}   — remove edge
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { GraphResponse, AddRelationshipRequest, RelationshipType } from './types';

// --- Query keys ---

const graphKey = ['graph'] as const;

// --- Queries ---

export function useGraphQuery() {
  return useQuery({
    queryKey: graphKey,
    queryFn: () => apiFetch<GraphResponse>('/api/v1/graph', { method: 'GET' }),
    staleTime: 30_000,
  });
}

// --- Mutations ---

export function useAddRelationshipMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AddRelationshipRequest) =>
      apiFetch<void>(`/api/v1/items/${itemId}/relationships`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: graphKey });
    },
  });
}

export function useDeleteRelationshipMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ targetId, type }: { targetId: string; type: RelationshipType }) =>
      apiFetch<void>(`/api/v1/items/${itemId}/relationships/${targetId}/${type}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: graphKey });
    },
  });
}
