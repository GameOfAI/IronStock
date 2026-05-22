import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // PR-F3: gcTime uzatıldı — offline modda in-memory cache oturum boyunca yaşar.
      // Disk cache (offline-cache.ts) sayesinde yeniden açılışta da veri sunulur.
      gcTime: 30 * 60_000, // 30 dakika (varsayılan 5dk'dan artırıldı)
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
    tags: (id: string) => ['items', id, 'tags'] as const,
  },
  catalog: {
    fieldDefinitions: ['catalog', 'field-definitions'] as const,
    itemTypes: ['catalog', 'item-types'] as const,
    userPublicKey: (id: string) => ['catalog', 'users', id, 'public-key'] as const,
  },
  attachments: {
    byItem: (itemId: string) => ['attachments', { itemId }] as const,
  },
  admin: {
    users: (limit: number, offset: number) => ['admin', 'users', { limit, offset }] as const,
    auditLog: (filters: Record<string, unknown>) => ['admin', 'audit-log', filters] as const,
  },
} as const;
