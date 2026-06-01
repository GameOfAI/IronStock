import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

const QK = 'k8s-clusters';

// ── Types ────────────────────────────────────────────────────────────────────

export interface K8sCluster {
  id: string;
  name: string;
  server_url: string;
  auth_mode: 'token' | 'kubeconfig';
  has_token: boolean;
  has_kubeconfig: boolean;
  ca_cert_pem?: string;
  skip_tls_verify: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface K8sClustersResponse {
  clusters: K8sCluster[];
}

export interface CreateK8sClusterRequest {
  name: string;
  server_url: string;
  auth_mode: 'token' | 'kubeconfig';
  token?: string;
  kubeconfig_yaml?: string;
  ca_cert_pem?: string;
  skip_tls_verify: boolean;
  enabled: boolean;
}

export interface UpdateK8sClusterRequest {
  name: string;
  server_url: string;
  auth_mode: 'token' | 'kubeconfig';
  token?: string;
  kubeconfig_yaml?: string;
  ca_cert_pem?: string;
  skip_tls_verify: boolean;
  enabled: boolean;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAdminK8sClustersQuery() {
  return useQuery({
    queryKey: [QK],
    queryFn: () => apiFetch<K8sClustersResponse>('/api/v1/admin/k8s/clusters'),
    select: (data) => data.clusters,
  });
}

export function useCreateK8sClusterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateK8sClusterRequest) =>
      apiFetch<{ id: string }>('/api/v1/admin/k8s/clusters', {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useUpdateK8sClusterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...req }: UpdateK8sClusterRequest & { id: string }) =>
      apiFetch<void>(`/api/v1/admin/k8s/clusters/${id}`, {
        method: 'PUT',
        body: req,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useDeleteK8sClusterMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/admin/k8s/clusters/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [QK] });
    },
  });
}

export function useTestK8sClusterMutation() {
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ version: Record<string, string> }>(`/api/v1/admin/k8s/clusters/${id}/test`, {
        method: 'POST',
      }),
  });
}
