/**
 * /inventory — KeePassXC tarzı 3-panel layout.
 *
 *   ┌────────────┬──────────────────────────┬─────────────────────────┐
 *   │ FolderTree │ ItemList + Search        │ ItemDetail              │
 *   │  (sol)     │ (orta)                   │ (sağ)                   │
 *   └────────────┴──────────────────────────┴─────────────────────────┘
 *
 * URL state (tek source-of-truth): `?folder=<id>&item=<id>&q=<text>`.
 * Bookmark + back button + paylaşılabilir URL pattern'i (ADR-0009 §1).
 *
 * Search HMAC blind-index → exact match. UI'da kullanıcıyı uyaran
 * "Tam isim" hint'i ItemSearch içinde.
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { useFieldDefinitions, useItemTypes } from '@/api/catalog';
import { useItems } from '@/api/items';
import { FolderTree } from '@/components/inventory/folder-tree';
import { ItemList } from '@/components/inventory/item-list';
import { ItemSearch } from '@/components/inventory/item-search';
import { ItemDetail } from '@/components/inventory/item-detail';

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const itemId = searchParams.get('item');
  const query = searchParams.get('q') ?? '';

  const fieldDefsQuery = useFieldDefinitions();
  const itemTypesQuery = useItemTypes();
  const itemsQuery = useItems(folderId, query);

  const updateParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mut(next);
      setSearchParams(next, { replace: false });
    },
    [searchParams, setSearchParams],
  );

  const handleSelectFolder = (id: string) => {
    updateParams((p) => {
      p.set('folder', id);
      // Yeni klasöre geçince eski item seçimi anlamsız
      p.delete('item');
    });
  };

  const handleSelectItem = (id: string) => {
    updateParams((p) => p.set('item', id));
  };

  const handleSearchCommit = useCallback(
    (value: string) => {
      updateParams((p) => {
        if (value) p.set('q', value);
        else p.delete('q');
        // Yeni arama → açık item seçimini bırak (sonuç değişebilir)
        p.delete('item');
      });
    },
    [updateParams],
  );

  return (
    <Card className="h-[calc(100vh-9rem)] overflow-hidden p-0">
      <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_minmax(0,420px)]">
        {/* Sol: FolderTree */}
        <aside className="overflow-y-auto border-r bg-muted/20">
          <FolderTree selectedId={folderId} onSelect={handleSelectFolder} />
        </aside>

        {/* Orta: Search + ItemList */}
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="border-b p-3">
            <ItemSearch
              initial={query}
              onCommit={handleSearchCommit}
              disabled={!folderId}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            <ItemList
              items={itemsQuery.data?.items}
              isLoading={itemsQuery.isLoading || itemsQuery.isFetching}
              isError={itemsQuery.isError}
              folderSelected={!!folderId}
              searchQuery={query}
              selectedItemId={itemId}
              onSelect={handleSelectItem}
              itemTypes={itemTypesQuery.data?.item_types ?? []}
            />
          </div>
        </section>

        {/* Sağ: ItemDetail */}
        <aside className="overflow-y-auto border-l bg-card">
          <ItemDetail
            itemId={itemId}
            fieldDefinitions={fieldDefsQuery.data?.field_definitions ?? []}
            itemTypes={itemTypesQuery.data?.item_types ?? []}
          />
        </aside>
      </div>
    </Card>
  );
}
