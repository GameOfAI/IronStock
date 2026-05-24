import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/folders', () => {
  const useRootFolders = vi.fn();
  const useChildFolders = vi.fn();
  return { useRootFolders, useChildFolders };
});

import * as foldersApi from '@/api/folders';
import { FolderTree } from './folder-tree';
import { sampleFolders, sampleSubFolders } from './__fixtures__';

const useRootFolders = foldersApi.useRootFolders as unknown as ReturnType<typeof vi.fn>;
const useChildFolders = foldersApi.useChildFolders as unknown as ReturnType<typeof vi.fn>;

function renderTree(props: Parameters<typeof FolderTree>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FolderTree {...props} />
    </QueryClientProvider>,
  );
}

function setRootSuccess(data: typeof sampleFolders) {
  useRootFolders.mockReturnValue({ data: { folders: data }, isLoading: false, isError: false });
}

function setChildSuccess(data: typeof sampleSubFolders) {
  useChildFolders.mockReturnValue({
    data: { folders: data },
    isLoading: false,
    isError: false,
    isSuccess: true,
  });
}

describe('FolderTree', () => {
  it('shows loading state', () => {
    useRootFolders.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    useChildFolders.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false });
    renderTree({ selectedId: null, onSelect: () => {} });
    expect(screen.getByText(/klasörler yükleniyor/i)).toBeInTheDocument();
  });

  it('shows empty state when no root folders', () => {
    setRootSuccess([]);
    useChildFolders.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false });
    renderTree({ selectedId: null, onSelect: () => {} });
    expect(screen.getByText(/klasör yok/i)).toBeInTheDocument();
  });

  it('renders root folders and calls onSelect when clicked', async () => {
    const user = userEvent.setup();
    setRootSuccess(sampleFolders);
    useChildFolders.mockReturnValue({ data: undefined, isLoading: false, isSuccess: false });
    const onSelect = vi.fn();
    renderTree({ selectedId: null, onSelect });
    await user.click(screen.getByText('Production'));
    expect(onSelect).toHaveBeenCalledWith('f-prod');
  });

  it('expands node and renders children', async () => {
    const user = userEvent.setup();
    setRootSuccess(sampleFolders);
    setChildSuccess(sampleSubFolders);
    renderTree({ selectedId: null, onSelect: () => {} });

    const expanders = screen.getAllByRole('button', { name: /klasörü aç/i });
    await user.click(expanders[0]);
    expect(screen.getByText('Databases')).toBeInTheDocument();
  });
});
