import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ItemList } from './item-list';
import { sampleItems, sampleItemTypes } from './__fixtures__';

const noop = () => {};

describe('ItemList', () => {
  it('shows "klasör seçin" when no folder selected', () => {
    render(
      <ItemList
        items={undefined}
        isLoading={false}
        isError={false}
        folderSelected={false}
        searchQuery=""
        selectedItemId={null}
        onSelect={noop}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/soldan bir klasör seçin/i)).toBeInTheDocument();
  });

  it('renders items with type label and permission badge', () => {
    render(
      <ItemList
        items={sampleItems}
        isLoading={false}
        isError={false}
        folderSelected
        searchQuery=""
        selectedItemId={null}
        onSelect={noop}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText('mysql-prod')).toBeInTheDocument();
    expect(screen.getByText('redis-prod')).toBeInTheDocument();
    expect(screen.getAllByText('Veritabanı').length).toBe(2);
    expect(screen.getByText('W')).toBeInTheDocument();
    expect(screen.getByText('R')).toBeInTheDocument();
  });

  it('shows search-specific empty state when q present and no results', () => {
    render(
      <ItemList
        items={[]}
        isLoading={false}
        isError={false}
        folderSelected
        searchQuery="nope"
        selectedItemId={null}
        onSelect={noop}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/"nope" araması ile eşleşen item yok/i)).toBeInTheDocument();
  });

  it('shows generic empty state when folder has no items', () => {
    render(
      <ItemList
        items={[]}
        isLoading={false}
        isError={false}
        folderSelected
        searchQuery=""
        selectedItemId={null}
        onSelect={noop}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/bu klasörde item yok/i)).toBeInTheDocument();
  });

  it('calls onSelect when row clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <ItemList
        items={sampleItems}
        isLoading={false}
        isError={false}
        folderSelected
        searchQuery=""
        selectedItemId={null}
        onSelect={onSelect}
        itemTypes={sampleItemTypes}
      />,
    );
    await user.click(screen.getByText('mysql-prod'));
    expect(onSelect).toHaveBeenCalledWith('i-1');
  });

  it('renders error state when isError', () => {
    render(
      <ItemList
        items={undefined}
        isLoading={false}
        isError
        folderSelected
        searchQuery=""
        selectedItemId={null}
        onSelect={noop}
        itemTypes={sampleItemTypes}
      />,
    );
    expect(screen.getByText(/item listesi alınamadı/i)).toBeInTheDocument();
  });
});
