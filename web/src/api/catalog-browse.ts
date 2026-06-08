/**
 * PR-CATALOG: Backstage-style service catalog browse endpoint.
 *
 * GET /api/v1/catalog/items — RBAC-filtered flat list of all accessible items
 * with pre-joined metadata (tags, lifecycle stages, health, relationships).
 *
 * Name + health_score are plaintext on the server (name_plain + cached score),
 * so no client-side decryption is needed.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// --- Types ---

export interface CatalogItem {
  id: string;
  item_type_id: number;
  folder_id: string;
  folder_name: string;
  name: string;
  description?: string;
  /** Cached health score 0-100, null if not yet scored. */
  health_score: number | null;
  health_severity: 'healthy' | 'warning' | 'critical' | null;
  expires_at: string | null;
  tags: string[];
  lifecycle_stage_ids: number[];
  relationship_count: number;
  is_favorite: boolean;
  /** "owner" | "write" | "read" | "admin" */
  permission: string;
}

export interface CatalogBrowseResponse {
  items: CatalogItem[];
  total: number;
}

export interface CatalogBrowseParams {
  type_id?: number;
  q?: string;
  severity?: 'healthy' | 'warning' | 'critical';
  tag?: string;
  limit?: number;
  offset?: number;
}

// --- Query key factory ---

export const catalogBrowseKey = (params: CatalogBrowseParams) =>
  ['catalog', 'browse', params] as const;

// --- Hook ---

/**
 * Fetch catalog items with optional filters.
 * staleTime 30s — the catalog is a live view, data should feel fresh.
 */
export function useCatalogBrowseQuery(params: CatalogBrowseParams = {}) {
  const query: Record<string, string> = {};
  if (params.type_id != null) query['type_id'] = String(params.type_id);
  if (params.q) query['q'] = params.q;
  if (params.severity) query['severity'] = params.severity;
  if (params.tag) query['tag'] = params.tag;
  if (params.limit != null) query['limit'] = String(params.limit);
  if (params.offset != null) query['offset'] = String(params.offset);

  return useQuery({
    queryKey: catalogBrowseKey(params),
    queryFn: () =>
      apiFetch<CatalogBrowseResponse>('/api/v1/catalog/items', { query }),
    staleTime: 30_000,
  });
}
