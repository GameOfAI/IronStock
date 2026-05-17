/**
 * Pipeline diagram endpoints (PR-F5d).
 *
 * CRUD for named diagram views + node management + layout save + filtered graph.
 *
 * NOTE: apiFetch's RequestOptions takes `body` as a plain object (not stringified)
 * and does NOT accept a custom `headers` field — Content-Type is set automatically
 * when body is present.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  PipelineDiagramsListResponse,
  PipelineDiagramDetail,
  PipelineDiagramMeta,
  CreatePipelineDiagramRequest,
  UpdatePipelineDiagramRequest,
  AddDiagramNodesRequest,
  SaveDiagramLayoutRequest,
  DiagramGraphResponse,
} from './types';

// --- Query keys ---

export const pipelineDiagramsKey = ['pipeline-diagrams'] as const;
export const pipelineDiagramKey = (id: string) => ['pipeline-diagrams', id] as const;
export const diagramGraphKey = (id: string) => ['pipeline-diagrams', id, 'graph'] as const;

// --- Queries ---

/** List all diagrams for the current user. */
export function usePipelineDiagramsQuery() {
  return useQuery({
    queryKey: pipelineDiagramsKey,
    queryFn: () =>
      apiFetch<PipelineDiagramsListResponse>('/api/v1/pipeline-diagrams', { method: 'GET' }),
    staleTime: 30_000,
  });
}

/** Get a single diagram with its nodes. */
export function usePipelineDiagramQuery(id: string | null) {
  return useQuery({
    queryKey: pipelineDiagramKey(id ?? ''),
    queryFn: () =>
      apiFetch<PipelineDiagramDetail>(`/api/v1/pipeline-diagrams/${id}`, { method: 'GET' }),
    enabled: !!id,
    staleTime: 30_000,
  });
}

/** Get the filtered graph (nodes + edges) for a diagram. */
export function useDiagramGraphQuery(id: string | null) {
  return useQuery({
    queryKey: diagramGraphKey(id ?? ''),
    queryFn: () =>
      apiFetch<DiagramGraphResponse>(`/api/v1/pipeline-diagrams/${id}/graph`, {
        method: 'GET',
      }),
    enabled: !!id,
    staleTime: 15_000,
  });
}

// --- Mutations ---

/** Create a new pipeline diagram. */
export function useCreatePipelineDiagramMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreatePipelineDiagramRequest) =>
      apiFetch<PipelineDiagramMeta>('/api/v1/pipeline-diagrams', {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramsKey });
    },
  });
}

/** Update diagram name/description. */
export function useUpdatePipelineDiagramMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: UpdatePipelineDiagramRequest) =>
      apiFetch<void>(`/api/v1/pipeline-diagrams/${id}`, {
        method: 'PUT',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramKey(id) });
      qc.invalidateQueries({ queryKey: pipelineDiagramsKey });
    },
  });
}

/** Delete a pipeline diagram. */
export function useDeletePipelineDiagramMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/pipeline-diagrams/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramsKey });
    },
  });
}

/** Add items to a diagram. */
export function useAddDiagramNodesMutation(diagramId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AddDiagramNodesRequest) =>
      apiFetch<void>(`/api/v1/pipeline-diagrams/${diagramId}/nodes`, {
        method: 'POST',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramKey(diagramId) });
      qc.invalidateQueries({ queryKey: diagramGraphKey(diagramId) });
    },
  });
}

/** Remove an item from a diagram. */
export function useRemoveDiagramNodeMutation(diagramId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<void>(`/api/v1/pipeline-diagrams/${diagramId}/nodes/${itemId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramKey(diagramId) });
      qc.invalidateQueries({ queryKey: diagramGraphKey(diagramId) });
    },
  });
}

/** Save node positions and viewport. */
export function useSaveDiagramLayoutMutation(diagramId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: SaveDiagramLayoutRequest) =>
      apiFetch<void>(`/api/v1/pipeline-diagrams/${diagramId}/layout`, {
        method: 'PUT',
        body: req,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineDiagramKey(diagramId) });
    },
  });
}
