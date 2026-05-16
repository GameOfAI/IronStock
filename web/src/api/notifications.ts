/**
 * Notification endpoints (PR-N8).
 *
 * GET  /api/v1/notifications           — list recent + unread count
 * GET  /api/v1/notifications/unread-count — lightweight count for badge
 * POST /api/v1/notifications/{id}/read  — mark single as read
 * POST /api/v1/notifications/read-all   — mark all as read
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { NotificationsListResponse, UnreadCountResponse } from './types';

// --- Query keys (from centralised registry) ---

const notificationsKey = queryKeys.notifications.all;
const unreadCountKey = [...queryKeys.notifications.all, 'unread-count'] as const;

// --- Queries ---

export function useNotificationsQuery() {
  return useQuery({
    queryKey: notificationsKey,
    queryFn: () =>
      apiFetch<NotificationsListResponse>('/api/v1/notifications', { method: 'GET' }),
    // Poll every 60 seconds as a fallback in case the WS event is missed.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useUnreadCountQuery() {
  return useQuery({
    queryKey: unreadCountKey,
    queryFn: () =>
      apiFetch<UnreadCountResponse>('/api/v1/notifications/unread-count', { method: 'GET' }),
    refetchInterval: 60_000,
    staleTime: 15_000,
  });
}

// --- Mutations ---

export function useMarkReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

export function useMarkAllReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>('/api/v1/notifications/read-all', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}
