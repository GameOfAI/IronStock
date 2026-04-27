/**
 * /inventory — KeePassXC tarzı 3-panel layout.
 *
 *   ┌────────────┬──────────────────────────┬─────────────────────────┐
 *   │ FolderTree │ ItemList + Search        │ ItemDetail              │
 *   │  (sol)     │ (orta)                   │ (sağ)                   │
 *   └────────────┴──────────────────────────┴─────────────────────────┘
 *
 * URL state (tek source-of-truth): `?folder=<id>&item=<id>&q=<text>`.
 * Toolbar actions open modals wired here; modals do their own mutations.
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FolderPlus, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFieldDefinitions, useItemTypes } from '@/api/catalog';
import { useItems } from '@/api/items';
import { useFolder } from '@/api/folders';
import { FolderTree } from '@/components/inventory/folder-tree';
import { ItemList } from '@/components/inventory/item-list';
import { ItemSearch } from '@/components/inventory/item-search';
import { ItemDetail } from '@/components/inventory/item-detail';
import { FolderFormModal } from '@/components/inventory/folder-form-modal';
import { FolderDeleteDialog } from '@/components/inventory/folder-delete-dialog';
import { ItemFormModal } from '@/components/inventory/item-form-modal';
import { ItemDeleteDialog } from '@/components/inventory/item-delete-dialog';
import { ItemShareModal } from '@/components/inventory/item-share-modal';
import type { Item } from '@/api/types';

type FolderModal = 'create' | 'rename' | 'delete' | null;
type ItemModal = 'create' | 'edit' | 'delete' | 'share' | null;

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const itemId = searchParams.get('item');
  const query = searchParams.get('q') ?? '';

  const [folderModal, setFolderModal] = useState<FolderModal>(null);
  const [itemModal, setItemModal] = useState<ItemModal>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);

  const fieldDefsQuery = useFieldDefinitions();
  const itemTypesQuery = useItemTypes();
  const itemsQuery = useItems(folderId, query);
  const folderQuery = useFolder(folderId);

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

  const selectedItem = activeItem ?? itemsQuery.data?.items.find((i) => i.id === itemId) ?? null;

  function openItemModal(modal: ItemModal, item?: Item) {
    setActiveItem(item ?? null);
    setItemModal(modal);
  }

  return (
    <Card className="h-[calc(100vh-9rem)] overflow-hidden p-0">
      <div className="grid h-full grid-cols-[260px_minmax(0,1fr)_minmax(0,420px)]">
        {/* Sol: FolderTree + folder toolbar */}
        <aside className="flex min-h-0 flex-col border-r bg-muted/20">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Klasörler
            </span>
            <div className="flex gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Yeni klasör"
                onClick={() => setFolderModal('create')}
              >
                <FolderPlus size={14} />
              </Button>
              {folderId && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label="Klasörü yeniden adlandır"
                    onClick={() => setFolderModal('rename')}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:text-destructive"
                    aria-label="Klasörü sil"
                    onClick={() => setFolderModal('delete')}
                  >
                    <Trash2 size={14} />
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            <FolderTree selectedId={folderId} onSelect={handleSelectFolder} />
          </div>
        </aside>

        {/* Orta: Search + item toolbar + ItemList */}
        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b p-2">
            <div className="flex-1">
              <ItemSearch initial={query} onCommit={handleSearchCommit} disabled={!folderId} />
            </div>
            {folderId && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                aria-label="Yeni item"
                onClick={() => openItemModal('create')}
              >
                <Plus size={14} className="mr-1" />
                Yeni
              </Button>
            )}
          </div>
          {folderId && itemId && (
            <div className="flex items-center gap-1 border-b px-3 py-1.5">
              <span className="mr-auto text-xs text-muted-foreground truncate">
                {selectedItem?.name ?? itemId}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Item düzenle"
                onClick={() => selectedItem && openItemModal('edit', selectedItem)}
                disabled={!selectedItem}
              >
                <Pencil size={13} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Item paylaş"
                onClick={() => selectedItem && openItemModal('share', selectedItem)}
                disabled={!selectedItem}
              >
                <Share2 size={13} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 hover:text-destructive"
                aria-label="Item sil"
                onClick={() => selectedItem && openItemModal('delete', selectedItem)}
                disabled={!selectedItem}
              >
                <Trash2 size={13} />
              </Button>
            </div>
          )}
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

      {/* Folder modals */}
      <FolderFormModal
        open={folderModal === 'create'}
        onOpenChange={(v) => !v && setFolderModal(null)}
        parentId={folderId}
      />
      <FolderFormModal
        open={folderModal === 'rename'}
        onOpenChange={(v) => !v && setFolderModal(null)}
        editFolder={
          folderQuery.data
            ? {
                id: folderQuery.data.id,
                name: folderQuery.data.name,
                parent_id: folderQuery.data.parent_id,
              }
            : undefined
        }
      />
      <FolderDeleteDialog
        open={folderModal === 'delete'}
        onOpenChange={(v) => !v && setFolderModal(null)}
        folder={
          folderQuery.data
            ? {
                id: folderQuery.data.id,
                name: folderQuery.data.name,
                parent_id: folderQuery.data.parent_id,
              }
            : null
        }
        onDeleted={() => {
          updateParams((p) => {
            p.delete('folder');
            p.delete('item');
          });
        }}
      />

      {/* Item modals */}
      {folderId && (
        <>
          <ItemFormModal
            open={itemModal === 'create'}
            onOpenChange={(v) => !v && setItemModal(null)}
            folderId={folderId}
            fieldDefinitions={fieldDefsQuery.data?.field_definitions ?? []}
            itemTypes={itemTypesQuery.data?.item_types ?? []}
          />
          <ItemFormModal
            open={itemModal === 'edit'}
            onOpenChange={(v) => !v && setItemModal(null)}
            folderId={folderId}
            fieldDefinitions={fieldDefsQuery.data?.field_definitions ?? []}
            itemTypes={itemTypesQuery.data?.item_types ?? []}
            editItem={selectedItem}
          />
          <ItemDeleteDialog
            open={itemModal === 'delete'}
            onOpenChange={(v) => !v && setItemModal(null)}
            item={selectedItem}
            folderId={folderId}
            onDeleted={() => updateParams((p) => p.delete('item'))}
          />
          <ItemShareModal
            open={itemModal === 'share'}
            onOpenChange={(v) => !v && setItemModal(null)}
            item={selectedItem}
          />
        </>
      )}
    </Card>
  );
}
