import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';
import { getAccessToken } from './token-storage';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReportOptions {
  include_k8s_live: boolean;
  include_relationships: boolean;
  include_field_values: boolean;
  report_title: string;
}

export interface GenerateReportRequest {
  item_ids: string[];
  options: ReportOptions;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Generates an HTML report and triggers a browser download.
 * The server returns text/html; we create an object URL and click it.
 */
export function useGenerateReportMutation() {
  return useMutation({
    mutationFn: async (req: GenerateReportRequest): Promise<void> => {
      // We need raw fetch here because the response is HTML (not JSON).
      const token = getAccessToken() ?? '';
      const apiBase = (window as unknown as { __ENVANTER_API_BASE__?: string }).__ENVANTER_API_BASE__ ?? '';
      const resp = await fetch(`${apiBase}/api/v1/admin/reports/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(req),
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({ message: 'Rapor üretilemedi.' }));
        throw new Error((json as { message?: string }).message ?? 'Rapor üretilemedi.');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `ironstock-report-${date}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  });
}

// ── K8s item binding ──────────────────────────────────────────────────────────

export interface K8sBinding {
  item_id: string;
  cluster_id: string;
  namespace_name: string;
}

export function useK8sBindingQuery(itemId: string) {
  return {
    queryKey: ['k8s-binding', itemId],
    queryFn: () => apiFetch<K8sBinding>(`/api/v1/items/${itemId}/k8s/binding`),
  };
}

export function useSetK8sBindingMutation() {
  return useMutation({
    mutationFn: ({
      itemId,
      clusterId,
      namespaceName,
    }: {
      itemId: string;
      clusterId: string;
      namespaceName: string;
    }) =>
      apiFetch<K8sBinding>(`/api/v1/items/${itemId}/k8s/bind`, {
        method: 'POST',
        body: { cluster_id: clusterId, namespace_name: namespaceName },
      }),
  });
}
