/**
 * Admin endpoints — RBAC: admin role only.
 * Ported from web/src/api/admin.ts for Tauri client parity.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type {
  AdminUser,
  AdminUsersResponse,
  AuditLogFilters,
  AuditLogResponse,
  GrantRoleRequest,
} from './types';

// ---------- Create user ----------

export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
  roles: string[];
  totp_required?: boolean;
  requires_client_cert?: boolean;
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      apiFetch<AdminUser>('/api/v1/admin/users', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

// ---------- Users ----------

interface UsersQueryArgs {
  limit: number;
  offset: number;
}

export function useUsers({ limit, offset }: UsersQueryArgs) {
  return useQuery({
    queryKey: queryKeys.admin.users(limit, offset),
    queryFn: () =>
      apiFetch<AdminUsersResponse>('/api/v1/admin/users', {
        query: { limit, offset },
      }),
  });
}

function invalidateAllUserPages(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
}

export function useGrantRoleMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GrantRoleRequest) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/roles`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useRevokeRoleMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleName: string) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/roles/${roleName}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useDisableUserMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/disable`, { method: 'POST' }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useEnableUserMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/enable`, { method: 'POST' }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useResetTOTPMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/totp/reset`, { method: 'POST' }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useUpdateTOTPRequirementMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (required: boolean) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/totp-required`, {
        method: 'PATCH',
        body: { required },
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

// ---------- Audit log ----------

function buildAuditQuery(filters: AuditLogFilters): Record<string, string | number | undefined> {
  return {
    action: filters.action || undefined,
    actor_user_id: filters.actor_user_id || undefined,
    resource_type: filters.resource_type || undefined,
    resource_id: filters.resource_id || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    limit: filters.limit,
    offset: filters.offset,
  };
}

export function useAuditLog(filters: AuditLogFilters) {
  return useQuery({
    queryKey: queryKeys.admin.auditLog(filters as Record<string, unknown>),
    queryFn: () =>
      apiFetch<AuditLogResponse>('/api/v1/admin/audit-log', {
        query: buildAuditQuery(filters),
      }),
  });
}
