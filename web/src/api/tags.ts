/**
 * Tag + Favorites endpoints (PR-N7).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  Tag,
  TagListResponse,
  CreateTagRequest,
  AddItemTagRequest,
  ItemTagsResponse,
  FavoritesListResponse,
} from './types';

// --- Query keys ---

const tagsKey = ['tags'] as const;
const itemTagsKey = (itemId: string) => ['item-tags', itemId] as const;
const favoritesKey = ['favorites'] as const;
const favoriteStatusKey = (itemId: string) => ['favorite-status', itemId] as const;

// --- Tags ---

export function useTagsQuery() {
  return useQuery({
    queryKey: tagsKey,
    queryFn: () => apiFetch<TagListResponse>('/api/v1/tags'),
    staleTime: 60_000,
  });
}

export function useCreateTagMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateTagRequest) =>
      apiFetch<Tag>('/api/v1/tags', { method: 'POST', body: req }),
    onSuccess: () => qc.invalidateQueries({ queryKey: tagsKey }),
  });
}

export function useDeleteTagMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/api/v1/tags/${tagId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tagsKey });
      qc.invalidateQueries({ queryKey: ['item-tags'] });
    },
  });
}

// --- Item tags ---

export function useItemTagsQuery(itemId: string | null) {
  return useQuery({
    queryKey: itemTagsKey(itemId ?? ''),
    queryFn: () => apiFetch<ItemTagsResponse>(`/api/v1/items/${itemId}/tags`),
    enabled: itemId !== null && itemId !== '',
    staleTime: 30_000,
  });
}

export function useAddItemTagMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: AddItemTagRequest) =>
      apiFetch<void>(`/api/v1/items/${itemId}/tags`, { method: 'POST', body: req }),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemTagsKey(itemId) }),
  });
}

export function useRemoveItemTagMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tagId: string) =>
      apiFetch<void>(`/api/v1/items/${itemId}/tags/${tagId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: itemTagsKey(itemId) }),
  });
}

// --- Favorites ---

export function useFavoritesQuery() {
  return useQuery({
    queryKey: favoritesKey,
    queryFn: () => apiFetch<FavoritesListResponse>('/api/v1/favorites'),
    staleTime: 30_000,
  });
}

export function useFavoriteStatusQuery(itemId: string | null) {
  return useQuery({
    queryKey: favoriteStatusKey(itemId ?? ''),
    queryFn: () =>
      apiFetch<void>(`/api/v1/items/${itemId}/favorite`).then(() => true).catch(() => false),
    enabled: itemId !== null && itemId !== '',
    staleTime: 30_000,
  });
}

export function useAddFavoriteMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/items/${itemId}/favorite`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: favoritesKey });
      qc.invalidateQueries({ queryKey: favoriteStatusKey(itemId) });
    },
  });
}

export function useRemoveFavoriteMutation(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<void>(`/api/v1/items/${itemId}/favorite`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: favoritesKey });
      qc.invalidateQueries({ queryKey: favoriteStatusKey(itemId) });
    },
  });
}
