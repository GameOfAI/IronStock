import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  CreateLogForwardingRequest,
  LogForwardingConfig,
  LogForwardingListResponse,
  UpdateLogForwardingRequest,
} from '@envanter/shared/api/types';

const QK = 'log-forwarding-configs';

export function useLogForwardingConfigsQuery() {
  return useQuery({
    queryKey: [QK],
    queryFn: () => apiFetch<LogForwardingListResponse>('/api/v1/admin/log-forwarding'),
  });
}

export function useCreateLogForwardingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateLogForwardingRequest) =>
      apiFetch<LogForwardingConfig>('/api/v1/admin/log-forwarding', {
        method: 'POST',
        // apiFetch already JSON.stringifies the body — passing a pre-stringified
        // string here double-encodes it and the server rejects "invalid JSON".
        body: req,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useUpdateLogForwardingMutation(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateLogForwardingRequest) =>
      apiFetch<LogForwardingConfig>(`/api/v1/admin/log-forwarding/${id}`, {
        method: 'PUT',
        // See create mutation — body must be the object, not a JSON string.
        body: req,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useDeleteLogForwardingMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/admin/log-forwarding/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useTestLogForwardingMutation() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ status: string }>(`/api/v1/admin/log-forwarding/${id}/test`, {
        method: 'POST',
      }),
  });
}
