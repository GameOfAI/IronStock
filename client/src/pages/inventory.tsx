/**
 * /inventory — 3-panel layout with write operations (PR-C5).
 *
 *   ┌────────────┬──────────────────────────┬─────────────────────────┐
 *   │ FolderTree │ Toolbar + Search + List  │ ItemDetail              │
 *   │  (sol)     │ (orta)                   │ (sağ — E2E şifreli)     │
 *   └────────────┴──────────────────────────┴─────────────────────────┘
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFieldDefinitions, useItemTypes } from '@/api/catalog';
import { useItems } from '@/api/items';
import type { Item } from '@/api/types';
import { FolderTree } from '@/components/inventory/folder-tree';
import { ItemList } from '@/components/inventory/item-list';
import { ItemSearch } from '@/components/inventory/item-search';
import { ItemDetail } from '@/components/inventory/item-detail';
import { ItemFormModal } from '@/components/inventory/item-form-modal';
import { ItemDeleteDialog } from '@/components/inventory/item-delete-dialog';

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const itemId = searchParams.get('item');
  const query = searchParams.get('q') ?? '';

  const fieldDefsQuery = useFieldDefinitions();
  const itemTypesQuery = useItemTypes();
  const itemsQuery = useItems(folderId, query);

  const [formOpen, setFormOpen] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const selectedItem = itemsQuery.data?.items.find((i) => i.id === itemId) ?? null;

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
        p.delete('item');
      });
    },
    [updateParams],
  );

  function handleNewItem() {
    setEditItem(null);
    setFormOpen(true);
  }

  function handleEditItem() {
    if (!selectedItem) return;
    setEditItem(selectedItem);
    setFormOpen(true);
  }

  function handleDeleteItem() {
    if (!selectedItem) return;
    setDeleteTarget({ id: selectedItem.id, name: selectedItem.name });
    setDeleteOpen(true);
  }

  return (
    <>
      <Card className="h-[calc(100vh-9rem)] overflow-hidden p-0">
        <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_minmax(0,380px)]">
          {/* Sol: FolderTree */}
          <aside className="flex min-h-0 flex-col border-r bg-muted/20">
            <div className="border-b px-3 py-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Klasörler
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <FolderTree selectedId={folderId} onSelect={handleSelectFolder} />
            </div>
          </aside>

          {/* Orta: Toolbar + Search + ItemList */}
          <section className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b p-2">
              <div className="flex-1">
                <ItemSearch initial={query} onCommit={handleSearchCommit} disabled={!folderId} />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="default"
                  disabled={!folderId}
                  onClick={handleNewItem}
                  title="Yeni item"
                >
                  <Plus className="h-4 w-4" />
                  <span className="ml-1 hidden sm:inline">Yeni</span>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedItem}
                  onClick={handleEditItem}
                  title="Düzenle"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!selectedItem}
                  onClick={handleDeleteItem}
                  title="Sil"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
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

      {folderId && (
        <ItemFormModal
          open={formOpen}
          onOpenChange={setFormOpen}
          folderId={folderId}
          fieldDefinitions={fieldDefsQuery.data?.field_definitions ?? []}
          itemTypes={itemTypesQuery.data?.item_types ?? []}
          editItem={editItem}
        />
      )}

      <ItemDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        item={deleteTarget}
        folderId={folderId ?? ''}
        onDeleted={() => {
          updateParams((p) => p.delete('item'));
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
