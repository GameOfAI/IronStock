import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type {
  Attachment,
  AttachmentListResponse,
  AttachmentInitRequest,
  AttachmentInitResponse,
  AttachmentDownloadURLResponse,
} from './types';

export function useAttachments(itemId: string | null) {
  return useQuery({
    queryKey: queryKeys.attachments.byItem(itemId ?? ''),
    queryFn: () => apiFetch<AttachmentListResponse>(`/api/v1/items/${itemId}/attachments`),
    enabled: itemId !== null && itemId !== '',
    select: (data) => data.attachments,
  });
}

export function useInitUploadMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AttachmentInitRequest) =>
      apiFetch<AttachmentInitResponse>(`/api/v1/items/${itemId}/attachments`, {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attachments.byItem(itemId) });
    },
  });
}

export function useConfirmUploadMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/attachments/${attId}/confirm`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attachments.byItem(itemId) });
    },
  });
}

export function useDownloadURLMutation(itemId: string) {
  return useMutation({
    mutationFn: (attId: string) =>
      apiFetch<AttachmentDownloadURLResponse>(
        `/api/v1/items/${itemId}/attachments/${attId}/url`,
      ),
  });
}

export function useDeleteAttachmentMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (attId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/attachments/${attId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.attachments.byItem(itemId) });
    },
  });
}

export type { Attachment };
