import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// PR-HEALTH: Item health score API
// ---------------------------------------------------------------------------

export interface HealthBreakdown {
  rule: string;
  deduction: number;
  detail?: string;
}

export interface ItemHealthResponse {
  item_id: string;
  score: number;
  severity: 'healthy' | 'warning' | 'critical';
  breakdown: HealthBreakdown[];
}

export interface HealthReportItem {
  item_id: string;
  name: string;
  folder_id: string;
  health_score: number;
  severity: 'healthy' | 'warning' | 'critical';
}

export interface HealthReportResponse {
  threshold: number;
  count: number;
  items: HealthReportItem[];
}

/**
 * GET /api/v1/items/{id}/health — per-item health score with breakdown.
 * Enabled when itemId is non-empty. staleTime 60s (score changes rarely).
 */
export function useItemHealthQuery(itemId: string) {
  return useQuery({
    queryKey: ['items', itemId, 'health'],
    queryFn: () => apiFetch<ItemHealthResponse>(`/api/v1/items/${itemId}/health`),
    enabled: itemId.length > 0,
    staleTime: 60_000,
  });
}

/**
 * GET /api/v1/items/health-report?threshold=N&limit=N — admin dashboard widget.
 * Returns items below the score threshold sorted by score ascending.
 */
export function useHealthReportQuery(threshold = 70, limit = 10) {
  return useQuery({
    queryKey: ['items', 'health-report', threshold, limit],
    queryFn: () =>
      apiFetch<HealthReportResponse>('/api/v1/items/health-report', {
        query: { threshold: String(threshold), limit: String(limit) },
      }),
    staleTime: 120_000,
  });
}
