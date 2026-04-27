import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('./client', () => ({ apiFetch: vi.fn() }));

import * as clientModule from './client';
import { useChildFolders, useFolder, useRootFolders } from './folders';

const apiFetchMock = clientModule.apiFetch as unknown as ReturnType<typeof vi.fn>;

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => apiFetchMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe('useRootFolders', () => {
  it('GETs /folders without parent_id', async () => {
    apiFetchMock.mockResolvedValue({ folders: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useRootFolders(), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/folders');
  });
});

describe('useChildFolders', () => {
  it('does not fire when not enabled', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useChildFolders('f-prod', false), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('does not fire when parentId is null', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useChildFolders(null, true), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('GETs /folders?parent_id when enabled with id', async () => {
    apiFetchMock.mockResolvedValue({ folders: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useChildFolders('f-prod', true), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/folders', {
      query: { parent_id: 'f-prod' },
    });
  });
});

describe('useFolder', () => {
  it('does not fire when id is null', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useFolder(null), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('GETs /folders/:id when id provided', async () => {
    apiFetchMock.mockResolvedValue({ id: 'f-1' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useFolder('f-1'), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/folders/f-1');
  });
});
