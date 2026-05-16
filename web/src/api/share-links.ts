/**
 * One-Time Share Link endpoints (PR-N5).
 *
 * Auth-protected CRUD:
 *   POST   /api/v1/items/{id}/share-links   → create
 *   GET    /api/v1/items/{id}/share-links   → list active
 *   DELETE /api/v1/items/{id}/share-links/{link_id} → revoke
 *
 * Public view (no auth — unauthenticated: true):
 *   GET    /api/v1/share/{token}            → view encrypted payload
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  CreateShareLinkRequest,
  CreateShareLinkResponse,
  ShareLinksListResponse,
  ShareLinkViewResponse,
} from './types';

// ── query keys ──────────────────────────────────────────────────────────────

export const shareLinksKey = (itemId: string) =>
  ['share-links', itemId] as const;

// ── authenticated hooks ──────────────────────────────────────────────────────

/** List active share links for an item (write-permission required server-side). */
export function useShareLinksQuery(itemId: string | null) {
  return useQuery({
    queryKey: shareLinksKey(itemId ?? ''),
    queryFn: () =>
      apiFetch<ShareLinksListResponse>(
        `/api/v1/items/${itemId}/share-links`,
      ),
    enabled: itemId !== null && itemId !== '',
    staleTime: 15_000,
  });
}

/** Create a share link. Caller is responsible for supplying `dek_wrapped`. */
export function useCreateShareLinkMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateShareLinkRequest) =>
      apiFetch<CreateShareLinkResponse>(
        `/api/v1/items/${itemId}/share-links`,
        { method: 'POST', body: req },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: shareLinksKey(itemId) }),
  });
}

/** Revoke (delete) a specific share link. */
export function useRevokeShareLinkMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiFetch<void>(
        `/api/v1/items/${itemId}/share-links/${linkId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: shareLinksKey(itemId) }),
  });
}

// ── public hook (no auth) ────────────────────────────────────────────────────

/**
 * Fetch the encrypted payload for a share link.
 * Called from the public /share/:token page — no access token is available.
 */
export function useShareLinkViewQuery(token: string | null) {
  return useQuery({
    queryKey: ['share-view', token] as const,
    queryFn: () =>
      apiFetch<ShareLinkViewResponse>(
        `/api/v1/share/${token}`,
        { unauthenticated: true },
      ),
    enabled: token !== null && token !== '',
    // Never auto-refetch — each fetch increments the server-side view_count.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
  });
}
