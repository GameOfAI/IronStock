import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/items', () => ({
  useDeleteItemMutation: vi.fn(),
}));

import * as itemsApi from '@/api/items';
import { ItemDeleteDialog } from './item-delete-dialog';

const useDelete = itemsApi.useDeleteItemMutation as ReturnType<typeof vi.fn>;

function renderDialog(props: Parameters<typeof ItemDeleteDialog>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ItemDeleteDialog {...props} />
    </QueryClientProvider>,
  );
}

describe('ItemDeleteDialog', () => {
  it('shows item name in description', () => {
    useDelete.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    renderDialog({
      open: true,
      onOpenChange: () => {},
      item: { id: 'i-1', name: 'mysql-prod' },
      folderId: 'f-1',
    });
    expect(screen.getByText('mysql-prod')).toBeInTheDocument();
  });

  it('calls mutateAsync with item id on confirm', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useDelete.mockReturnValue({ mutateAsync, isPending: false });
    const onDeleted = vi.fn();
    renderDialog({
      open: true,
      onOpenChange: () => {},
      item: { id: 'i-1', name: 'mysql-prod' },
      folderId: 'f-1',
      onDeleted,
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /sil/i }));
    });
    expect(mutateAsync).toHaveBeenCalledWith('i-1');
    expect(onDeleted).toHaveBeenCalled();
  });

  it('does not call mutateAsync when item is null', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useDelete.mockReturnValue({ mutateAsync, isPending: false });
    renderDialog({
      open: true,
      onOpenChange: () => {},
      item: null,
      folderId: 'f-1',
    });

    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: /sil/i }));
    });
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
