/**
 * Admin endpoints — RBAC: admin role only (RequireRole on server).
 *
 * Two domains here:
 *   1. User management — list, role grant/revoke, disable/enable
 *   2. Audit log query — filtered + paginated
 *
 * Mutations invalidate the relevant queries on success so the table
 * reflects fresh state without manual refetch. WebSocket-driven realtime
 * is a PR-W6 follow-up; for now the client refreshes via cache invalidation.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import { getAccessToken } from './token-storage';
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
  /** PR-SEC1: TOTP zorunluluğu (default true). */
  totp_required?: boolean;
  /** PR-SEC3: Client cert (mTLS) zorunluluğu (default false). */
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

/** Invalidate every paginated users page so the new state shows everywhere. */
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
      apiFetch<void>(`/api/v1/admin/users/${userId}/disable`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

export function useEnableUserMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/enable`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

// ---------- TOTP Reset (PR-UX3) ----------

export function useResetTOTPMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/totp/reset`, {
        method: 'POST',
      }),
    onSuccess: () => invalidateAllUserPages(queryClient),
  });
}

// ---------- TOTP Requirement Toggle (PR-SEC1) ----------

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

/**
 * Build query params for the audit log endpoint. Empty/undefined values
 * are dropped so we don't send `?action=` (server treats empty as no filter).
 */
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

// ---------- Export (PR-Export) ----------

export type ExportFormat = 'json' | 'csv';

/**
 * Triggers a metadata export download.
 * Uses native fetch (not apiFetch) so we can handle the binary/text
 * response as a Blob and create a download link.
 */
export async function downloadAdminExport(format: ExportFormat = 'json'): Promise<void> {
  const token = getAccessToken();
  const res = await fetch(`/api/v1/admin/export?format=${format}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? `Export başarısız (${res.status})`);
  }
  const blob = await res.blob();
  const ext = format === 'csv' ? 'csv' : 'json';
  const date = new Date().toISOString().slice(0, 10);
  const filename = `ironstock-export-${date}.${ext}`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
