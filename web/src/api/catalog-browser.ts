/**
 * Catalog browser hooks (PR-DP04).
 * Uses the cross-folder search endpoint for item discovery.
 * Kind filter is client-side for now; backend kind param added in PR-DP05.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { ItemListResponse } from './types';

export interface CatalogFilters {
  q: string;
  kind?: string | null;
  fuzzy?: boolean;
}

export function useCatalogQuery(filters: CatalogFilters) {
  const trimmed = filters.q.trim();
  return useQuery({
    queryKey: ['catalog-browser', trimmed, filters.fuzzy ?? false],
    queryFn: () =>
      apiFetch<ItemListResponse>('/api/v1/items/search', {
        query: {
          q: trimmed,
          ...(filters.fuzzy ? { fuzzy: 'true' } : {}),
        },
      }),
    enabled: trimmed.length >= 2,
    staleTime: 15_000,
    select: (data) => {
      if (!filters.kind) return data;
      return {
        items: data.items.filter((item) => item.kind === filters.kind),
      };
    },
  });
}
