/**
 * Folder endpoints — read-only hooks for PR-W4 (inventory read).
 *
 * Server `GET /api/v1/folders[?parent_id=]` lazy-loaded model:
 *   - Without parent_id → root folders the caller can READ
 *   - With parent_id    → immediate children (gated by Read on parent)
 *
 * Tree node ilk kez expand edilince useChildFolders aktive olur, sonraki
 * collapse/expand'lerde TanStack Query cache'inden gelir.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Folder, FolderListResponse } from './types';

/**
 * Root folder'ları çeker (parent_id yok). Tree'nin başlangıç noktası.
 */
export function useRootFolders() {
  return useQuery({
    queryKey: queryKeys.folders.byParent(null),
    queryFn: () => apiFetch<FolderListResponse>('/api/v1/folders'),
  });
}

/**
 * Bir folder'ın direkt çocuklarını çeker. `enabled` parametresi tree
 * lazy-load için: node expand olduğunda true olur.
 */
export function useChildFolders(parentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.folders.byParent(parentId),
    queryFn: () =>
      apiFetch<FolderListResponse>('/api/v1/folders', {
        query: parentId ? { parent_id: parentId } : {},
      }),
    enabled: enabled && parentId !== null,
  });
}

/**
 * Tek folder detayı — breadcrumb için. PR-W4'te detail panel
 * "Klasör: ..." göstergesinde kullanılır.
 */
export function useFolder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.folders.detail(id ?? ''),
    queryFn: () => apiFetch<Folder>(`/api/v1/folders/${id}`),
    enabled: id !== null,
  });
}
