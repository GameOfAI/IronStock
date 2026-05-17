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
import { Copy, FolderPlus, FolderTree as FolderTreeIcon, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useFieldDefinitions, useItemTypes } from '@/api/catalog';
import { useItem, useItems } from '@/api/items';
import { useFolder } from '@/api/folders';
import { useAuthStore } from '@/store/auth';
import { useToast } from '@/hooks/use-toast';
import { fromBase64, openDEKWithKEK, decryptField } from '@/lib/crypto';
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

type FolderModal = 'create-root' | 'create-sub' | 'rename' | 'delete' | null;
type ItemModal = 'create' | 'edit' | 'delete' | 'share' | null;

export default function InventoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get('folder');
  const itemId = searchParams.get('item');
  const query = searchParams.get('q') ?? '';

  const [folderModal, setFolderModal] = useState<FolderModal>(null);
  const [itemModal, setItemModal] = useState<ItemModal>(null);
  const [activeItem, setActiveItem] = useState<Item | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<{
    name: string;
    description?: string;
    itemTypeId: number;
    fieldValues: Record<number, string>;
  } | null>(null);

  const privateKey = useAuthStore((s) => s.privateKey);
  const { toast } = useToast();

  const fieldDefsQuery = useFieldDefinitions();
  const itemTypesQuery = useItemTypes();
  const itemsQuery = useItems(folderId, query);
  const folderQuery = useFolder(folderId);
  // Full item (with encrypted fields + DEK) for duplicate decryption.
  const fullItemQuery = useItem(itemId);

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
    // Clear any stale duplicate prefill when opening a regular create/edit.
    setDuplicateFrom(null);
    setItemModal(modal);
  }

  async function handleDuplicate() {
    const item = fullItemQuery.data;
    if (!item) {
      toast({
        title: 'Item yükleniyor',
        description: 'Item detayı hazır olduğunda tekrar deneyin.',
      });
      return;
    }
    if (!privateKey) {
      toast({
        title: 'Anahtar yok',
        description: 'Şifreleme anahtarı bulunamadı. Yeniden giriş yapın.',
        variant: 'destructive',
      });
      return;
    }
    if (!item.owner_dek_wrapped || !item.owner_wrap_nonce) {
      toast({
        title: 'Kopyalanamadı',
        description: 'Owner DEK eksik (sunucu döndürmedi).',
        variant: 'destructive',
      });
      return;
    }

    try {
      const dek = await openDEKWithKEK(
        fromBase64(item.owner_dek_wrapped),
        fromBase64(item.owner_wrap_nonce),
        privateKey,
      );
      const fieldValues: Record<number, string> = {};
      for (const f of item.fields ?? []) {
        if (!f.value_enc || !f.value_nonce) continue;
        try {
          const v = await decryptField(fromBase64(f.value_enc), fromBase64(f.value_nonce), dek);
          fieldValues[f.field_definition_id] = v;
        } catch {
          // skip un-decryptable field; others can still be copied
        }
      }
      setActiveItem(null);
      setDuplicateFrom({
        name: `${item.name} (kopya)`,
        description: item.description,
        itemTypeId: item.item_type_id,
        fieldValues,
      });
      setItemModal('create');
    } catch (err) {
      toast({
        title: 'Kopyalanamadı',
        description: err instanceof Error ? err.message : 'Şifre çözme başarısız.',
        variant: 'destructive',
      });
    }
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
              {/* Her zaman görünür: kök klasör oluştur */}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Yeni kök klasör"
                title="Yeni kök klasör"
                onClick={() => setFolderModal('create-root')}
              >
                <FolderPlus size={14} />
              </Button>
              {/* Sadece klasör seçiliyken: alt klasör ekle, yeniden adlandır, sil */}
              {folderId && (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label="Seçili klasörün içine alt klasör ekle"
                    title="Alt klasör ekle"
                    onClick={() => setFolderModal('create-sub')}
                  >
                    <FolderTreeIcon size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    aria-label="Klasörü yeniden adlandır"
                    title="Yeniden adlandır"
                    onClick={() => setFolderModal('rename')}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:text-destructive"
                    aria-label="Klasörü sil"
                    title="Klasörü sil"
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
                aria-label="Item kopyala"
                title="Kopya oluştur"
                onClick={handleDuplicate}
                disabled={!selectedItem || !fullItemQuery.data}
              >
                <Copy size={13} />
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
      {/* Kök klasör — parent yok */}
      <FolderFormModal
        open={folderModal === 'create-root'}
        onOpenChange={(v) => !v && setFolderModal(null)}
        parentId={null}
      />
      {/* Alt klasör — seçili klasörün içine */}
      <FolderFormModal
        open={folderModal === 'create-sub'}
        onOpenChange={(v) => !v && setFolderModal(null)}
        parentId={folderId}
        isSubFolder
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
            onOpenChange={(v) => {
              if (!v) {
                setItemModal(null);
                setDuplicateFrom(null);
              }
            }}
            folderId={folderId}
            fieldDefinitions={fieldDefsQuery.data?.field_definitions ?? []}
            itemTypes={itemTypesQuery.data?.item_types ?? []}
            duplicateFrom={duplicateFrom}
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
            item={fullItemQuery.data ?? selectedItem}
          />
        </>
      )}
    </Card>
  );
}
