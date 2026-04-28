import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

/**
 * Single shared QueryClient. Conservative defaults — handlers can opt
 * into more aggressive refetch via per-query options.
 *
 * Retry policy: only retry on network errors (status 0). Server-emitted
 * ApiErrors (4xx, 5xx) usually mean "do not retry, surface to user".
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s — folder lists, item lists rarely change between hits
      gcTime: 5 * 60_000, // 5min — keep cache around for back/forward nav
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

/**
 * Standardised query key factory — keeps cache invalidation surgical.
 * Hooks pass the corresponding builder; WS event handlers (PR-W6) call
 * `queryClient.invalidateQueries({ queryKey: queryKeys.items.byFolder(id) })`.
 */
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
  admin: {
    users: (limit: number, offset: number) => ['admin', 'users', { limit, offset }] as const,
    auditLog: (filters: Record<string, unknown>) => ['admin', 'audit-log', filters] as const,
  },
  attachments: {
    byItem: (itemId: string) => ['attachments', { itemId }] as const,
  },
} as const;
