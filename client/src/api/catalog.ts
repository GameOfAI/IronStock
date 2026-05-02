import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './client';
import { queryKeys } from './query';
import type { FieldDefinitionsResponse, ItemTypesResponse } from './types';

export function useFieldDefinitions() {
  return useQuery({
    queryKey: queryKeys.catalog.fieldDefinitions,
    queryFn: () => apiFetch<FieldDefinitionsResponse>('/api/v1/field-definitions'),
    staleTime: Infinity,
  });
}

export function useItemTypes() {
  return useQuery({
    queryKey: queryKeys.catalog.itemTypes,
    queryFn: () => apiFetch<ItemTypesResponse>('/api/v1/item-types'),
    staleTime: Infinity,
  });
}
