/**
 * Admin SSO/LDAP provider management API hooks (PR-LDAP).
 *
 * GET  /api/v1/admin/sso/providers         — list all providers (admin)
 * POST /api/v1/admin/sso/providers         — create provider
 * PUT  /api/v1/admin/sso/providers/{id}    — update provider
 * DELETE /api/v1/admin/sso/providers/{id}  — delete provider
 * POST /api/v1/admin/sso/providers/{id}/test — test LDAP connection
 *
 * Public list (login page, no auth):
 * GET  /api/v1/auth/sso/providers          — enabled providers only
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AdminSSOProvidersListResponse,
  SSOProvidersListResponse,
  CreateSSOProviderRequest,
  LDAPTestResult,
} from './types';

/** List all SSO providers (admin — includes disabled). */
export function useAdminSSOProvidersQuery() {
  return useQuery({
    queryKey: ['admin', 'sso-providers'],
    queryFn: () => apiFetch<AdminSSOProvidersListResponse>('/api/v1/admin/sso/providers'),
    staleTime: 30_000,
  });
}

/** List enabled SSO providers for the login page (no auth required). */
export function usePublicSSOProvidersQuery() {
  return useQuery({
    queryKey: ['sso-providers', 'public'],
    queryFn: () => apiFetch<SSOProvidersListResponse>('/api/v1/auth/sso/providers'),
    staleTime: 60_000,
  });
}

/** Create a new SSO/LDAP provider. */
export function useCreateSSOProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSSOProviderRequest) =>
      apiFetch<{ id: string }>('/api/v1/admin/sso/providers', {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sso-providers'] }),
  });
}

/** Update an existing SSO/LDAP provider. */
export function useUpdateSSOProviderMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: Partial<CreateSSOProviderRequest>) =>
      apiFetch<void>(`/api/v1/admin/sso/providers/${id}`, {
        method: 'PUT',
        body: req,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sso-providers'] }),
  });
}

/** Delete an SSO/LDAP provider (cascades user_sso_identities). */
export function useDeleteSSOProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/admin/sso/providers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'sso-providers'] }),
  });
}

/** Test LDAP connection (bind as service account). LDAP providers only. */
export function useTestLDAPConnectionMutation() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<LDAPTestResult>(`/api/v1/admin/sso/providers/${id}/test`, { method: 'POST' }),
  });
}
