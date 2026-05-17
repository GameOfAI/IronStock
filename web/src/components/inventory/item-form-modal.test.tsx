import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/items', () => ({
  useCreateItemMutation: vi.fn(),
  useUpdateItemMutation: vi.fn(),
}));

vi.mock('@/store/auth', () => ({
  useAuthStore: vi.fn((selector: (s: unknown) => unknown) => {
    const store = {
      privateKey: new Uint8Array(32).fill(1),
      user: { id: 'u-1', username: 'alice', roles: [] },
    };
    return selector(store);
  }),
}));

import * as itemsApi from '@/api/items';
import { ItemFormModal } from './item-form-modal';
import { sampleFieldDefinitions, sampleItemTypes } from './__fixtures__';

const useCreate = itemsApi.useCreateItemMutation as ReturnType<typeof vi.fn>;
const useUpdate = itemsApi.useUpdateItemMutation as ReturnType<typeof vi.fn>;

function makeMutationStub(mutateAsync = vi.fn().mockResolvedValue({})) {
  // reset() is called by the modal's open useEffect to clear stale errors.
  return { mutateAsync, reset: vi.fn(), isPending: false, error: null };
}

function renderModal(props: Partial<Parameters<typeof ItemFormModal>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ItemFormModal
        open={true}
        onOpenChange={() => {}}
        folderId="f-1"
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe('ItemFormModal — create', () => {
  it('renders "Yeni Item" title', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal();
    expect(screen.getByText('Yeni Item')).toBeInTheDocument();
  });

  it('disables submit when name is empty', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal();
    expect(screen.getByRole('button', { name: 'Oluştur' })).toBeDisabled();
  });

  it('enables submit when name is filled', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal();
    fireEvent.change(screen.getByLabelText(/^Ad/i), { target: { value: 'my-item' } });
    expect(screen.getByRole('button', { name: 'Oluştur' })).toBeEnabled();
  });

  it('calls createMutation on submit (async encrypt)', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreate.mockReturnValue(makeMutationStub(mutateAsync));
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal();

    fireEvent.change(screen.getByLabelText(/^Ad/i), { target: { value: 'mysql-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }));
    // Async crypto (SHA-256 + AES-GCM) completes outside React's scheduler;
    // waitFor polls until mutateAsync is called.
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce(), { timeout: 3000 });
    const arg = mutateAsync.mock.calls[0][0];
    expect(arg.name).toBe('mysql-test');
    expect(arg.folder_id).toBe('f-1');
    expect(typeof arg.owner_dek_wrapped).toBe('string');
    expect(typeof arg.owner_wrap_nonce).toBe('string');
  });
});

describe('ItemFormModal — edit', () => {
  it('renders "Item Düzenle" title with pre-filled name', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    const editItem = {
      id: 'i-1',
      folder_id: 'f-1',
      item_type_id: 1,
      name: 'mysql-prod',
      fields: [],
      created_by: 'u-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      permission: 'write' as const,
    };
    renderModal({ editItem });
    expect(screen.getByText('Item Düzenle')).toBeInTheDocument();
    expect(screen.getByDisplayValue('mysql-prod')).toBeInTheDocument();
  });

  it('calls updateMutation with new name', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub(mutateAsync));
    const editItem = {
      id: 'i-1',
      folder_id: 'f-1',
      item_type_id: 1,
      name: 'old-name',
      fields: [],
      created_by: 'u-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      permission: 'write' as const,
    };
    renderModal({ editItem });

    fireEvent.change(screen.getByDisplayValue('old-name'), { target: { value: 'new-name' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ name: 'new-name' }));
  });

  it('shows description field in edit mode', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    const editItem = {
      id: 'i-1',
      folder_id: 'f-1',
      item_type_id: 1,
      name: 'item',
      description: 'existing note',
      fields: [],
      created_by: 'u-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      permission: 'write' as const,
    };
    renderModal({ editItem });
    expect(screen.getByDisplayValue('existing note')).toBeInTheDocument();
  });
});
