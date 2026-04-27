/**
 * Integration tests for admin hooks.
 *
 * Mocks `apiFetch` (the typed fetch wrapper) and verifies hook outputs +
 * mutation invalidation behaviour. Hooks are exercised via QueryClient.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('./client', () => ({
  apiFetch: vi.fn(),
}));

import * as clientModule from './client';
import {
  useAuditLog,
  useDisableUserMutation,
  useEnableUserMutation,
  useGrantRoleMutation,
  useRevokeRoleMutation,
  useUsers,
} from './admin';

const apiFetchMock = clientModule.apiFetch as unknown as ReturnType<typeof vi.fn>;

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useUsers', () => {
  it('calls /api/v1/admin/users with limit + offset query', async () => {
    apiFetchMock.mockResolvedValue({ users: [], total: 0, limit: 50, offset: 0 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useUsers({ limit: 50, offset: 100 }), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/users', {
      query: { limit: 50, offset: 100 },
    });
  });
});

describe('useAuditLog', () => {
  it('drops empty filter values from query', async () => {
    apiFetchMock.mockResolvedValue({ entries: [], total: 0, limit: 50, offset: 0 });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () =>
        useAuditLog({
          action: 'auth.login',
          actor_user_id: '',
          resource_type: '',
          from: '',
          to: '',
          limit: 50,
          offset: 0,
        }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/audit-log', {
      query: {
        action: 'auth.login',
        actor_user_id: undefined,
        resource_type: undefined,
        resource_id: undefined,
        from: undefined,
        to: undefined,
        limit: 50,
        offset: 0,
      },
    });
  });
});

describe('user mutations', () => {
  it('useGrantRoleMutation hits POST /roles with body', async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useGrantRoleMutation('u1'), { wrapper: wrapper(qc) });
    await result.current.mutateAsync({ role: 'admin' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/users/u1/roles', {
      method: 'POST',
      body: { role: 'admin' },
    });
  });

  it('useRevokeRoleMutation hits DELETE /roles/:role', async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRevokeRoleMutation('u1'), { wrapper: wrapper(qc) });
    await result.current.mutateAsync('write');
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/users/u1/roles/write', {
      method: 'DELETE',
    });
  });

  it('useDisableUserMutation hits POST /disable', async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDisableUserMutation('u1'), { wrapper: wrapper(qc) });
    await result.current.mutateAsync(undefined);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/users/u1/disable', {
      method: 'POST',
    });
  });

  it('useEnableUserMutation hits POST /enable', async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEnableUserMutation('u1'), { wrapper: wrapper(qc) });
    await result.current.mutateAsync(undefined);
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/admin/users/u1/enable', {
      method: 'POST',
    });
  });

  it('mutations invalidate the admin users query on success', async () => {
    apiFetchMock.mockResolvedValue(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useGrantRoleMutation('u1'), { wrapper: wrapper(qc) });
    await result.current.mutateAsync({ role: 'read' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });
});
