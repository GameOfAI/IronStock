import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

// ---------------------------------------------------------------------------
// PR-ANSIBLE: API token management
// ---------------------------------------------------------------------------

export interface APIToken {
  id: string;
  name: string;
  scope: 'read' | 'ansible' | 'scim' | 'scan';
  expires_at?: string;
  last_used_at?: string;
  created_at: string;
  /** Only present on creation response */
  token?: string;
}

export interface CreateTokenRequest {
  name: string;
  scope: 'read' | 'ansible' | 'scim' | 'scan';
  expires_at?: string;
}

export function useAPITokensQuery() {
  return useQuery({
    queryKey: ['api-tokens'],
    queryFn: () =>
      apiFetch<{ tokens: APIToken[] }>('/api/v1/users/me/api-tokens'),
    staleTime: 60_000,
  });
}

export function useCreateAPITokenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTokenRequest) =>
      apiFetch<APIToken>('/api/v1/users/me/api-tokens', {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
}

export function useDeleteAPITokenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/users/me/api-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  });
}
