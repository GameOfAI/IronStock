import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Folder, FolderListResponse } from './types';

export function useRootFolders() {
  return useQuery({
    queryKey: queryKeys.folders.byParent(null),
    queryFn: () => apiFetch<FolderListResponse>('/api/v1/folders'),
  });
}

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

export function useFolder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.folders.detail(id ?? ''),
    queryFn: () => apiFetch<Folder>(`/api/v1/folders/${id}`),
    enabled: id !== null,
  });
}
