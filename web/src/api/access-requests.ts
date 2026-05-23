/**
 * Onay/Checkout Workflow API hooks (PR-N3).
 *
 * Access requests allow admins to gate items behind an explicit approval step.
 * Non-owners must request access; admins approve/deny; upon approval the
 * requester can view secret fields for the approved duration.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AccessRequest,
  AccessRequestsListResponse,
  CreateAccessRequestRequest,
  ApproveAccessRequestRequest,
  DenyAccessRequestRequest,
} from './types';

/** List access requests. Admin: all; user: own. Optionally filter by status/item_id. */
export function useAccessRequestsQuery(params?: { status?: string; item_id?: string }) {
  return useQuery({
    queryKey: ['access-requests', params],
    queryFn: () =>
      apiFetch<AccessRequestsListResponse>('/api/v1/access-requests', {
        query: { status: params?.status, item_id: params?.item_id },
      }),
    staleTime: 15_000,
  });
}

/** Create an access request for an item. */
export function useCreateAccessRequestMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateAccessRequestRequest) =>
      apiFetch<AccessRequest>(`/api/v1/items/${itemId}/access-requests`, {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      qc.invalidateQueries({ queryKey: ['item', itemId] });
    },
  });
}

/** Approve a pending access request (admin only). */
export function useApproveAccessRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reqId, body }: { reqId: string; body?: ApproveAccessRequestRequest }) =>
      apiFetch<void>(`/api/v1/access-requests/${reqId}/approve`, {
        method: 'POST',
        body: body ?? {},
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/** Deny a pending access request (admin only). */
export function useDenyAccessRequestMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reqId, body }: { reqId: string; body: DenyAccessRequestRequest }) =>
      apiFetch<void>(`/api/v1/access-requests/${reqId}/deny`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
    },
  });
}

/** Cancel own pending access request. */
export function useCancelAccessRequestMutation(itemId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reqId: string) =>
      apiFetch<void>(`/api/v1/access-requests/${reqId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      if (itemId) qc.invalidateQueries({ queryKey: ['item', itemId] });
    },
  });
}

/** Toggle requires_approval on an item (admin only). */
export function useToggleApprovalRequiredMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (required: boolean) =>
      apiFetch<void>(`/api/v1/items/${itemId}/approval-required`, {
        method: 'PATCH',
        body: { required },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['item', itemId] });
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });
}
