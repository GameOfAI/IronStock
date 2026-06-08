/**
 * Portal template endpoints (PR-DP11).
 * Golden Path scaffold blueprints for the Create wizard.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  PortalTemplate,
  PortalTemplateListResponse,
  CreatePortalTemplateRequest,
} from './types';

const portalTemplatesKey = (kindKey?: string) =>
  kindKey ? ['portal-templates', { kind_key: kindKey }] : ['portal-templates'];

export function usePortalTemplatesQuery(kindKey?: string, all?: boolean) {
  return useQuery({
    queryKey: [...portalTemplatesKey(kindKey), all ? 'all' : 'active'],
    queryFn: () =>
      apiFetch<PortalTemplateListResponse>('/api/v1/portal-templates', {
        query: {
          ...(kindKey ? { kind_key: kindKey } : {}),
          ...(all ? { all: 'true' } : {}),
        },
      }),
    staleTime: 60_000,
  });
}

export function usePortalTemplateQuery(id: string | null) {
  return useQuery({
    queryKey: ['portal-templates', id],
    queryFn: () => apiFetch<PortalTemplate>(`/api/v1/portal-templates/${id}`),
    enabled: id !== null && id !== '',
    staleTime: 60_000,
  });
}

export function useCreatePortalTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreatePortalTemplateRequest) =>
      apiFetch<void>('/api/v1/portal-templates', { method: 'POST', body: req }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-templates'] }),
  });
}

export function useUpdatePortalTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CreatePortalTemplateRequest & { id: string }) =>
      apiFetch<void>(`/api/v1/portal-templates/${id}`, { method: 'PUT', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-templates'] }),
  });
}

export function useDeletePortalTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/portal-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal-templates'] }),
  });
}
