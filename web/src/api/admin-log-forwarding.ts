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
        body: JSON.stringify(req),
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
        body: JSON.stringify(req),
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
