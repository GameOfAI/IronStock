import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('./client', () => ({ apiFetch: vi.fn() }));

import * as clientModule from './client';
import { useItem, useItems } from './items';

const apiFetchMock = clientModule.apiFetch as unknown as ReturnType<typeof vi.fn>;

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => apiFetchMock.mockReset());
afterEach(() => vi.clearAllMocks());

describe('useItems', () => {
  it('does not fire when folderId is null', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useItems(null), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('does not fire when folderId is empty string', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useItems('', 'foo'), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('GETs /items with folder_id when no search query', async () => {
    apiFetchMock.mockResolvedValue({ items: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useItems('f-1'), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/items', {
      query: { folder_id: 'f-1', q: undefined },
    });
  });

  it('GETs /items with q query param when search provided', async () => {
    apiFetchMock.mockResolvedValue({ items: [] });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useItems('f-1', 'mysql-prod'), {
      wrapper: wrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/items', {
      query: { folder_id: 'f-1', q: 'mysql-prod' },
    });
  });
});

describe('useItem', () => {
  it('does not fire when id is null', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useItem(null), { wrapper: wrapper(qc) });
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('GETs /items/:id when id provided', async () => {
    apiFetchMock.mockResolvedValue({ id: 'i-1', name: 'mysql' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useItem('i-1'), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/v1/items/i-1');
  });
});
