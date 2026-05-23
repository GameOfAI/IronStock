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

// ---------------------------------------------------------------------------
// PR-NOTIFY: Notification Prefs + External Channels
// ---------------------------------------------------------------------------

export type NotificationType =
  | 'access_request'
  | 'share_added'
  | 'credential_expiring'
  | 'security_alert'
  | 'mention'
  | 'system_announcement'
  | 'break_glass_alert';

export type NotificationChannel = 'inapp' | 'email' | 'slack' | 'teams';

export interface NotificationPref {
  notification_type: NotificationType;
  channels: NotificationChannel[];
}

export interface NotificationPrefsResponse {
  prefs: NotificationPref[];
}

export interface ExternalChannel {
  id: string;
  channel_type: 'slack' | 'teams';
  channel_name: string;
  enabled: boolean;
  last_used_at?: string;
  last_error?: string;
  created_at: string;
}

export interface ExternalChannelsResponse {
  channels: ExternalChannel[];
}

export interface AddChannelRequest {
  channel_type: 'slack' | 'teams';
  webhook_url: string;
  channel_name: string;
}

export const notificationPrefsQueryKey = ['notification-prefs'] as const;

export function useNotificationPrefsQuery() {
  return useQuery({
    queryKey: notificationPrefsQueryKey,
    queryFn: () => apiFetch<NotificationPrefsResponse>('/api/v1/users/me/notification-prefs'),
    staleTime: 60_000,
  });
}

export function useUpdateNotificationPrefsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: NotificationPref[]) =>
      apiFetch<{ message: string }>('/api/v1/users/me/notification-prefs', {
        method: 'PUT',
        body: { prefs },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationPrefsQueryKey });
    },
  });
}

export const externalChannelsQueryKey = ['external-channels'] as const;

export function useExternalChannelsQuery() {
  return useQuery({
    queryKey: externalChannelsQueryKey,
    queryFn: () => apiFetch<ExternalChannelsResponse>('/api/v1/users/me/channels'),
    staleTime: 30_000,
  });
}

export function useAddExternalChannelMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddChannelRequest) =>
      apiFetch<ExternalChannel>('/api/v1/users/me/channels', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: externalChannelsQueryKey });
    },
  });
}

export function useDeleteExternalChannelMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/users/me/channels/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: externalChannelsQueryKey });
    },
  });
}

export function useTestExternalChannelMutation() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ message: string }>(`/api/v1/users/me/channels/${id}/test`, {
        method: 'POST',
      }),
  });
}
