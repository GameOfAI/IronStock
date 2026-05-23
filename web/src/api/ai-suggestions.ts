import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// PR-AI: AI tag/relationship suggestion API
// ---------------------------------------------------------------------------

export interface AISuggestion {
  id: string;
  item_id: string;
  suggestion_type: 'tag' | 'relationship';
  /** Raw JSON object — depends on suggestion_type */
  payload: Record<string, string>;
  accepted_at?: string;
  rejected_at?: string;
  created_at: string;
}

export interface SuggestResponse {
  item_id: string;
  suggestions: AISuggestion[];
  count: number;
}

export interface SuggestionsListResponse {
  item_id: string;
  suggestions: AISuggestion[];
  count: number;
}

/**
 * POST /api/v1/items/{id}/suggest — call LLM and persist suggestions.
 * Returns 501 when no LLM provider is configured server-side.
 */
export function useSuggestMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<SuggestResponse>(`/api/v1/items/${itemId}/suggest`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items', itemId, 'suggestions'] });
    },
  });
}

/** GET /api/v1/items/{id}/suggestions — list pending suggestions. */
export function useSuggestionsQuery(itemId: string) {
  return useQuery({
    queryKey: ['items', itemId, 'suggestions'],
    queryFn: () =>
      apiFetch<SuggestionsListResponse>(`/api/v1/items/${itemId}/suggestions`),
    enabled: itemId.length > 0,
    staleTime: 30_000,
  });
}

/** POST /api/v1/items/{id}/suggestions/{sid}/accept */
export function useAcceptSuggestionMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/suggestions/${sid}/accept`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items', itemId, 'suggestions'] });
      void qc.invalidateQueries({ queryKey: ['items', itemId] }); // tags may have changed
    },
  });
}

/** POST /api/v1/items/{id}/suggestions/{sid}/reject */
export function useRejectSuggestionMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sid: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/suggestions/${sid}/reject`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items', itemId, 'suggestions'] });
    },
  });
}
