/**
 * Tags API hooks — client paketi.
 * Sadece okuma (useItemTagsQuery) burada; tag oluşturma/ekleme/çıkarma PR-UX2'de
 * web paketinde yapıldı. Client MVP'de etiketler sadece görüntülenir.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { ItemTagsResponse } from './types';

export function useItemTagsQuery(itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.items.tags(itemId ?? ''),
    queryFn: () => apiFetch<ItemTagsResponse>(`/api/v1/items/${itemId}/tags`),
    enabled: Boolean(itemId),
  });
}
