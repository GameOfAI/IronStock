/**
 * Item links API — PR-LINK: Linked Entries.
 *
 * GET    /api/v1/items/{id}/links
 * POST   /api/v1/items/{id}/links
 * DELETE /api/v1/items/{id}/links/{link_id}
 *
 * Mirror links: when a source field changes, the server returns mirror_link_ids
 * in the item Update response. The client is responsible for re-encrypting and
 * propagating the field value to linked target items.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface ItemLink {
  id: string;
  source_item_id: string;
  source_field_def_id: string;
  target_item_id: string;
  target_item_name: string;
  target_field_def_id: string;
  target_field_def_name: string;
  link_type: 'mirror' | 'reference';
  created_by: string;
  created_at: string;
}

export interface CreateLinkRequest {
  target_item_id: string;
  source_field_def_id: string;
  target_field_def_id: string;
  link_type: 'mirror' | 'reference';
}

export function useItemLinksQuery(itemId: string) {
  return useQuery({
    queryKey: ['items', itemId, 'links'],
    queryFn: () =>
      apiFetch<{ links: ItemLink[] }>(`/api/v1/items/${itemId}/links`).then(
        (r) => r.links,
      ),
    enabled: !!itemId,
  });
}

export function useCreateLinkMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateLinkRequest) =>
      apiFetch<{ id: string }>(`/api/v1/items/${itemId}/links`, {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items', itemId, 'links'] });
    },
  });
}

export function useDeleteLinkMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/links/${linkId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items', itemId, 'links'] });
    },
  });
}
