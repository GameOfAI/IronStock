/**
 * Client Certificate (mTLS) admin endpoints — PR-SEC3.
 *
 * Architecture: IronStock uses nginx Ingress to terminate mTLS.
 * The ingress forwards the client cert as the `ssl-client-cert` header
 * (URL-encoded PEM) to the upstream server; the server validates the
 * fingerprint against the `client_certificates` table.
 *
 * Admin can:
 *   - Manage Certificate Authorities (built-in + external upload)
 *   - Issue leaf certs (signed by the built-in CA) for users
 *   - Register externally-issued certs for users
 *   - Revoke certs, toggle the per-user `requires_client_cert` flag
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  CertRequiredRequest,
  ClientCertCAListResponse,
  ClientCertListResponse,
  IssueCertRequest,
  IssueCertResponse,
  RegisterCertRequest,
  UploadCARequest,
} from './types';

// ---------- Query keys ----------

const certKeys = {
  cas: () => ['admin', 'client-cert-cas'] as const,
  userCerts: (userId: string) => ['admin', 'client-certs', userId] as const,
};

// ---------- CA management ----------

export function useClientCertCAsQuery() {
  return useQuery({
    queryKey: certKeys.cas(),
    queryFn: () => apiFetch<ClientCertCAListResponse>('/api/v1/admin/client-cert-cas'),
  });
}

export function useUploadCACertMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadCARequest) =>
      apiFetch<void>('/api/v1/admin/client-cert-cas', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.cas() }),
  });
}

export function useDeleteCACertMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caId: string) =>
      apiFetch<void>(`/api/v1/admin/client-cert-cas/${caId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.cas() }),
  });
}

// ---------- User cert management ----------

export function useUserClientCertsQuery(userId: string) {
  return useQuery({
    queryKey: certKeys.userCerts(userId),
    queryFn: () =>
      apiFetch<ClientCertListResponse>(`/api/v1/admin/users/${userId}/client-certs`),
    enabled: !!userId,
  });
}

export function useIssueClientCertMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input?: IssueCertRequest) =>
      apiFetch<IssueCertResponse>(`/api/v1/admin/users/${userId}/client-certs/issue`, {
        method: 'POST',
        body: input ?? {},
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
  });
}

export function useRegisterClientCertMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RegisterCertRequest) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/client-certs/register`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
  });
}

export function useRevokeClientCertMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (certId: string) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/client-certs/${certId}`, {
        method: 'DELETE',
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
  });
}

export function useUpdateClientCertRequirementMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CertRequiredRequest) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/cert-required`, {
        method: 'PATCH',
        body: input,
      }),
    onSuccess: () => {
      // Invalidate user list (requires_client_cert field shown there)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
