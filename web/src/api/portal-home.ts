import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Item, ItemListResponse } from './types';

export interface KindStat {
  kind: string;
  count: number;
}

export interface PortalStats {
  total_items: number;
  by_kind: KindStat[];
  expiring_soon: Item[];
  recent: Item[];
}

export function usePortalStatsQuery() {
  const allItemsQuery = useQuery({
    queryKey: ['portal-home', 'all'],
    queryFn: () =>
      apiFetch<ItemListResponse>('/api/v1/items/search', {
        query: { q: '', fuzzy: 'true', limit: '500' },
      }),
    staleTime: 60_000,
  });

  const items = allItemsQuery.data?.items ?? [];

  const byKindMap = new Map<string, number>();
  for (const item of items) {
    if (item.kind) {
      byKindMap.set(item.kind, (byKindMap.get(item.kind) ?? 0) + 1);
    }
  }
  const byKind: KindStat[] = Array.from(byKindMap.entries())
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count);

  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const expiringItems = items.filter((item) => {
    if (!item.expires_at) return false;
    const exp = new Date(item.expires_at).getTime();
    return exp > now && exp <= now + thirtyDays;
  });

  const recent = [...items]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8);

  return {
    isLoading: allItemsQuery.isLoading,
    isError: allItemsQuery.isError,
    stats: {
      total_items: items.length,
      by_kind: byKind,
      expiring_soon: expiringItems.slice(0, 5),
      recent,
    } satisfies PortalStats,
  };
}
