import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/folders', () => ({
  useCreateFolderMutation: vi.fn(),
  useUpdateFolderMutation: vi.fn(),
}));

import * as foldersApi from '@/api/folders';
import { FolderFormModal } from './folder-form-modal';

const useCreate = foldersApi.useCreateFolderMutation as ReturnType<typeof vi.fn>;
const useUpdate = foldersApi.useUpdateFolderMutation as ReturnType<typeof vi.fn>;

function makeMutationStub(mutateAsync = vi.fn().mockResolvedValue({})) {
  // reset() is called by the modal's open useEffect to clear stale errors.
  return { mutateAsync, reset: vi.fn(), isPending: false, error: null };
}

function renderModal(props: Parameters<typeof FolderFormModal>[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FolderFormModal {...props} />
    </QueryClientProvider>,
  );
}

describe('FolderFormModal — create', () => {
  it('renders dialog with "Yeni Kök Klasör" title by default (no isSubFolder)', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal({ open: true, onOpenChange: () => {} });
    expect(screen.getByText('Yeni Kök Klasör')).toBeInTheDocument();
  });

  it('renders dialog with "Yeni Alt Klasör" title when isSubFolder', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal({ open: true, onOpenChange: () => {}, parentId: 'p-1', isSubFolder: true });
    expect(screen.getByText('Yeni Alt Klasör')).toBeInTheDocument();
  });

  it('disables submit when name is empty', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal({ open: true, onOpenChange: () => {} });
    expect(screen.getByRole('button', { name: 'Oluştur' })).toBeDisabled();
  });

  it('calls createMutation with trimmed name on submit', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreate.mockReturnValue(makeMutationStub(mutateAsync));
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal({ open: true, onOpenChange: () => {}, parentId: 'parent-1' });

    fireEvent.change(screen.getByLabelText(/klasör adı/i), { target: { value: '  Servers  ' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }));
    });
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'Servers', parent_id: 'parent-1' });
  });
});

describe('FolderFormModal — rename', () => {
  it('renders "Klasörü Yeniden Adlandır" title with pre-filled name', () => {
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub());
    renderModal({
      open: true,
      onOpenChange: () => {},
      editFolder: { id: 'f-1', name: 'Production', parent_id: null },
    });
    expect(screen.getByText('Klasörü Yeniden Adlandır')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Production')).toBeInTheDocument();
  });

  it('calls updateMutation on submit', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({});
    useCreate.mockReturnValue(makeMutationStub());
    useUpdate.mockReturnValue(makeMutationStub(mutateAsync));
    renderModal({
      open: true,
      onOpenChange: () => {},
      editFolder: { id: 'f-1', name: 'OldName', parent_id: 'p-1' },
    });

    const input = screen.getByDisplayValue('OldName');
    fireEvent.change(input, { target: { value: 'NewName' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    });
    expect(mutateAsync).toHaveBeenCalledWith({ name: 'NewName', parent_id: 'p-1' });
  });
});
