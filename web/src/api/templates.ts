/**
 * PR-TPL: User-defined item template API hooks.
 *
 * Templates pre-fill item creation forms with default field values and tags.
 * Public templates are visible to all users; private templates only to owner/admin.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface TemplateField {
  field_def_key: string;
  default_value: string;
  required: boolean;
}

export interface ItemTemplate {
  id: string;
  name: string;
  description?: string;
  item_type_id: number;
  fields: TemplateField[];
  tags: string[];
  is_public: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  item_type_id: number;
  fields: TemplateField[];
  tags: string[];
  is_public: boolean;
}

export interface UpdateTemplateRequest {
  name: string;
  description?: string;
  fields: TemplateField[];
  tags: string[];
  is_public: boolean;
}

export type TemplateScope = 'mine' | 'public' | 'all';

/**
 * List templates. Scope: 'mine' | 'public' | 'all'.
 * 'all' is only meaningful for admins; non-admins get mine+public.
 */
export function useTemplatesQuery(scope: TemplateScope = 'public') {
  return useQuery({
    queryKey: ['templates', scope],
    queryFn: () =>
      apiFetch<{ templates: ItemTemplate[] }>('/api/v1/templates', {
        query: { scope },
      }).then((r) => r.templates),
    staleTime: 30_000,
  });
}

/** Create a new template. */
export function useCreateTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTemplateRequest) =>
      apiFetch<{ id: string }>('/api/v1/templates', {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/** Update an existing template (owner or admin). */
export function useUpdateTemplateMutation(templateId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdateTemplateRequest) =>
      apiFetch<void>(`/api/v1/templates/${templateId}`, {
        method: 'PUT',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/** Delete a template (owner or admin). */
export function useDeleteTemplateMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: string) =>
      apiFetch<void>(`/api/v1/templates/${templateId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}
