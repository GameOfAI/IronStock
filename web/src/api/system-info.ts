import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface SystemInfoResponse {
  server_version: string;
  uptime_seconds: number;
  db_status: 'healthy' | 'unhealthy';
  ws_connections: number;
  online_users?: number; // admin only
}

export function useSystemInfoQuery() {
  return useQuery({
    queryKey: ['system', 'info'],
    queryFn: () => apiFetch<SystemInfoResponse>('/api/v1/system/info'),
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
