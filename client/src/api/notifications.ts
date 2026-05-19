/**
 * Notifications API hooks — client paketi (PR-N8).
 *
 * Web paketindeki tam bildirim yönetimiyle paralel, daha kısaltılmış versiyon.
 * Client MVP'de: unread count, liste, mark-as-read.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { NotificationsListResponse, UnreadCountResponse } from './types';

const NOTIF_KEYS = {
  list: (limit: number) => ['notifications', { limit }] as const,
  unread: ['notifications', 'unread'] as const,
};

export function useNotificationsQuery(limit = 20) {
  return useQuery({
    queryKey: NOTIF_KEYS.list(limit),
    queryFn: () =>
      apiFetch<NotificationsListResponse>('/api/v1/notifications', {
        query: { limit },
      }),
    refetchInterval: 60_000, // her dakika polling (WS event'i olmayan bildirimler için)
  });
}

export function useUnreadCountQuery() {
  return useQuery({
    queryKey: NOTIF_KEYS.unread,
    queryFn: () => apiFetch<UnreadCountResponse>('/api/v1/notifications/unread-count'),
    refetchInterval: 30_000,
  });
}

export function useMarkAllReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<void>('/api/v1/notifications/mark-all-read', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkReadMutation(notifId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/notifications/${notifId}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
