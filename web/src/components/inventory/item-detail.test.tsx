import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/api/items', () => ({ useItem: vi.fn() }));

import * as itemsApi from '@/api/items';
import { ItemDetail } from './item-detail';
import { sampleFieldDefinitions, sampleItemTypes, sampleItems } from './__fixtures__';

const useItem = itemsApi.useItem as unknown as ReturnType<typeof vi.fn>;

describe('ItemDetail', () => {
  it('shows empty state when no itemId', () => {
    useItem.mockReturnValue({ data: undefined, isLoading: false, isError: false });
    render(
      <ItemDetail
        itemId={null}
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/detayları görmek için ortadaki listeden/i)).toBeInTheDocument();
  });

  it('shows skeleton while loading', () => {
    useItem.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { container } = render(
      <ItemDetail
        itemId="i-1"
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
      />,
    );
    // Skeleton uses div elements, just verify some pulse marker exists
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders item metadata + fields with encrypted placeholder', () => {
    useItem.mockReturnValue({ data: sampleItems[0], isLoading: false, isError: false });
    render(
      <ItemDetail
        itemId="i-1"
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByRole('heading', { name: 'mysql-prod' })).toBeInTheDocument();
    expect(screen.getByText('Veritabanı')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Parola')).toBeInTheDocument();
    // Both fields show "Şifreli" placeholder
    expect(screen.getAllByText('Şifreli').length).toBe(2);
    // E2E hint visible
    expect(screen.getByText(/uçtan uca şifreli/i)).toBeInTheDocument();
  });

  it('renders empty fields message when item has no fields', () => {
    useItem.mockReturnValue({ data: sampleItems[1], isLoading: false, isError: false });
    render(
      <ItemDetail
        itemId="i-2"
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/bu item'da alan tanımlı değil/i)).toBeInTheDocument();
  });

  it('shows error state when query fails', () => {
    useItem.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(
      <ItemDetail
        itemId="i-x"
        fieldDefinitions={sampleFieldDefinitions}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/item okunamadı/i)).toBeInTheDocument();
  });
});
