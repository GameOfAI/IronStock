/**
 * Client Certificate (mTLS) admin endpoints — PR-SEC3.
 * Ported from web/src/api/admin-client-certs.ts for Tauri client parity.
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
} from '@envanter/shared/api/types';

const certKeys = {
  cas: () => ['admin', 'client-cert-cas'] as const,
  userCerts: (userId: string) => ['admin', 'client-certs', userId] as const,
};

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
      apiFetch<void>('/api/v1/admin/client-cert-cas', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.cas() }),
  });
}

export function useDeleteCACertMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (caId: string) =>
      apiFetch<void>(`/api/v1/admin/client-cert-cas/${caId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.cas() }),
  });
}

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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
  });
}

export function useRevokeClientCertMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (certId: string) =>
      apiFetch<void>(`/api/v1/admin/users/${userId}/client-certs/${certId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: certKeys.userCerts(userId) }),
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
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}
