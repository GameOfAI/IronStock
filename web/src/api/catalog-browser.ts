/**
 * Catalog browser hooks (PR-DP04, PR-DP06).
 * Uses the cross-folder search endpoint for item discovery.
 * Backend kind param added in PR-DP05.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Item, ItemListResponse } from './types';

export interface CatalogFilters {
  q: string;
  kind?: string | null;
  fuzzy?: boolean;
}

/**
 * PR-DP06: Find a single item by kind + name for entity detail URL routing.
 * URL: /catalog/:kind/:namespace/:name
 * Uses the search endpoint (requires name >= 2 chars) and picks an exact match.
 * Returns undefined while loading, throws on not-found.
 */
export function useFindItemByKindAndName(kind: string, name: string) {
  const decodedName = decodeURIComponent(name);
  return useQuery<Item>({
    queryKey: ['catalog', 'by-kind-name', kind, decodedName],
    queryFn: async () => {
      const data = await apiFetch<ItemListResponse>('/api/v1/items/search', {
        query: { q: decodedName, kind },
      });
      const match = data.items.find(
        (item) =>
          item.kind === kind &&
          item.name.toLowerCase() === decodedName.toLowerCase(),
      );
      if (!match) throw new Error('not-found');
      return match;
    },
    enabled: decodedName.length >= 2,
    staleTime: 15_000,
    retry: false,
  });
}

export interface CatalogEntityResponse {
  item: {
    id: string;
    folder_id: string;
    name: string;
    description?: string;
    kind: string;
    item_type_id: number;
    owner_ref?: { kind: string; name: string };
    created_at: string;
    updated_at: string;
    expires_at?: string | null;
  };
  annotations: Record<string, string>;
  relationships: Array<{
    source_id: string;
    target_id: string;
    type: string;
    backstage_type?: string;
  }>;
  health?: {
    item_id: string;
    score: number;
    severity: string;
    breakdown: Array<{ rule: string; deduction: number; detail?: string }>;
  };
}

export function useCatalogEntityQuery(kind: string, name: string) {
  return useQuery<CatalogEntityResponse>({
    queryKey: ['catalog', 'entity', kind, name],
    queryFn: () =>
      apiFetch<CatalogEntityResponse>(
        `/api/v1/catalog/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
      ),
    enabled: kind.length > 0 && name.length > 0,
    staleTime: 15_000,
  });
}

export function useCatalogQuery(filters: CatalogFilters) {
  const trimmed = filters.q.trim();
  return useQuery({
    queryKey: ['catalog-browser', trimmed, filters.kind ?? null, filters.fuzzy ?? false],
    queryFn: () =>
      apiFetch<ItemListResponse>('/api/v1/items/search', {
        query: {
          q: trimmed,
          ...(filters.kind ? { kind: filters.kind } : {}),
          ...(filters.fuzzy ? { fuzzy: 'true' } : {}),
        },
      }),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
  });
}
