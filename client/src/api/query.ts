import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry(failureCount, error) {
        if (error instanceof ApiError && error.status > 0) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  me: {
    keypair: ['me', 'keypair'] as const,
  },
  folders: {
    all: ['folders'] as const,
    byParent: (parentId: string | null) => ['folders', { parentId }] as const,
    detail: (id: string) => ['folders', id] as const,
  },
  items: {
    all: ['items'] as const,
    byFolder: (folderId: string, q?: string) => ['items', { folderId, q }] as const,
    detail: (id: string) => ['items', id] as const,
  },
  catalog: {
    fieldDefinitions: ['catalog', 'field-definitions'] as const,
    itemTypes: ['catalog', 'item-types'] as const,
    userPublicKey: (id: string) => ['catalog', 'users', id, 'public-key'] as const,
  },
} as const;
