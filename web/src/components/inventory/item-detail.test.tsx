import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/items', () => ({
  useItem: vi.fn(),
  useRecordRotationMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useFieldVersionsQuery: vi.fn(() => ({ data: undefined, isLoading: false })),
}));
vi.mock('@/api/attachments', () => ({
  useAttachments: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
  useInitUploadMutation: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmUploadMutation: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDownloadURLMutation: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAttachmentMutation: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/api/tags', () => ({
  useFavoriteStatusQuery: vi.fn(() => ({ data: false })),
  useAddFavoriteMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRemoveFavoriteMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useItemTagsQuery: vi.fn(() => ({ data: [], isLoading: false })),
  useTagsQuery: vi.fn(() => ({ data: [], isLoading: false })),
  useAddItemTagMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useRemoveItemTagMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/api/graph', () => ({
  useGraphQuery: vi.fn(() => ({ data: { nodes: [], edges: [], lifecycle_stages: {} }, isLoading: false })),
  useAddRelationshipMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteRelationshipMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock('@/api/lifecycle', () => ({
  useLifecycleStagesQuery: vi.fn(() => ({ data: { stages: [] }, isLoading: false })),
  useItemLifecycleStagesQuery: vi.fn(() => ({ data: { stage_ids: [] }, isLoading: false })),
  useSetItemLifecycleStagesMutation: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

import * as itemsApi from '@/api/items';
import { ItemDetail } from './item-detail';
import { sampleFieldDefinitions, sampleItemTypes, sampleItems } from './__fixtures__';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

const useItem = itemsApi.useItem as unknown as ReturnType<typeof vi.fn>;

describe('ItemDetail', () => {
  it('shows empty state when no itemId', () => {
    useItem.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(
      wrap(
        <ItemDetail
          itemId={null}
          fieldDefinitions={sampleFieldDefinitions}
          itemTypes={sampleItemTypes}
        />,
      ),
    );
    expect(screen.getByText(/detayları görmek için listeden bir item seçin/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    useItem.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(
      wrap(
        <ItemDetail
          itemId="i-1"
          fieldDefinitions={sampleFieldDefinitions}
          itemTypes={sampleItemTypes}
        />,
      ),
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders item metadata + fields with encrypted placeholder', () => {
    useItem.mockReturnValue({ data: sampleItems[0], isLoading: false, isError: false });
    render(
      wrap(
        <ItemDetail
          itemId="i-1"
          fieldDefinitions={sampleFieldDefinitions}
          itemTypes={sampleItemTypes}
        />,
      ),
    );
    // Header is always visible
    expect(screen.getByText('mysql-prod')).toBeInTheDocument();
    expect(screen.getAllByText('Veritabanı').length).toBeGreaterThan(0);

    // Field rows live in the Alanlar tab panel (forceMount keeps them in DOM).
    expect(screen.getAllByText('Host', { hidden: true }).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Parola', { hidden: true }).length).toBeGreaterThan(0);
    // Without a privateKey in the auth store the decryption status stays
    // 'idle' and every field falls back to the "Şifreli" lock placeholder.
    expect(screen.getAllByText('Şifreli', { hidden: true }).length).toBe(2);
  });

  it('renders empty fields message when item has no fields', () => {
    useItem.mockReturnValue({ data: sampleItems[1], isLoading: false, isError: false });
    render(
      wrap(
        <ItemDetail
          itemId="i-2"
          fieldDefinitions={sampleFieldDefinitions}
          itemTypes={sampleItemTypes}
        />,
      ),
    );
    // Empty-fields message is in the Alanlar tab panel — query with hidden:true.
    expect(screen.getByText(/bu item'da alan tanımlı değil/i, { hidden: true })).toBeInTheDocument();
  });

  it('shows error state when query fails', () => {
    useItem.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(
      wrap(
        <ItemDetail
          itemId="i-x"
          fieldDefinitions={sampleFieldDefinitions}
          itemTypes={sampleItemTypes}
        />,
      ),
    );
    expect(screen.getByText(/item okunamadı/i)).toBeInTheDocument();
  });
});
