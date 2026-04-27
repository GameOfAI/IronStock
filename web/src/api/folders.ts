/**
 * Folder endpoints — read + write hooks (PR-W4 read, PR-W5 write).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { Folder, FolderListResponse, FolderRequest } from './types';

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
 * Tek folder detayı — breadcrumb için.
 */
export function useFolder(id: string | null) {
  return useQuery({
    queryKey: queryKeys.folders.detail(id ?? ''),
    queryFn: () => apiFetch<Folder>(`/api/v1/folders/${id}`),
    enabled: id !== null,
  });
}

export function useCreateFolderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: FolderRequest) =>
      apiFetch<Folder>('/api/v1/folders', { method: 'POST', body: req }),
    onSuccess: (_, req) => {
      qc.invalidateQueries({ queryKey: queryKeys.folders.byParent(req.parent_id ?? null) });
    },
  });
}

export function useUpdateFolderMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: FolderRequest) =>
      apiFetch<Folder>(`/api/v1/folders/${id}`, { method: 'PUT', body: req }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: queryKeys.folders.byParent(data.parent_id ?? null) });
      qc.invalidateQueries({ queryKey: queryKeys.folders.detail(id) });
    },
  });
}

export function useDeleteFolderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      apiFetch<void>(`/api/v1/folders/${id}`, { method: 'DELETE' }).then(() => ({
        id,
        parentId,
      })),
    onSuccess: ({ parentId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.folders.byParent(parentId) });
    },
  });
}
