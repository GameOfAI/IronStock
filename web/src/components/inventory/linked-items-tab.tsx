/**
 * LinkedItemsTab — PR-LINK: shows mirror/reference links on an item.
 *
 * Mirror links propagate field changes from this item to target items.
 * The actual re-encryption happens client-side (E2E constraint: server can't
 * read field values). The item Update handler returns `mirror_link_ids` which
 * the frontend must handle — this tab shows and manages the link registry.
 */

import { useState } from 'react';
import { Link2, Trash2, Plus, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  useItemLinksQuery,
  useCreateLinkMutation,
  useDeleteLinkMutation,
  type CreateLinkRequest,
} from '@/api/item-links';
import { useItem } from '@/api/items';

interface Props {
  itemId: string;
  fieldDefs: Array<{ id: string; label: string }>;
  canWrite: boolean;
}

export function LinkedItemsTab({ itemId, fieldDefs, canWrite }: Props) {
  const { data: links = [], isLoading } = useItemLinksQuery(itemId);
  const createLink = useCreateLinkMutation(itemId);
  const deleteLink = useDeleteLinkMutation(itemId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetItemId, setTargetItemId] = useState('');
  const [sourceFieldId, setSourceFieldId] = useState('');
  const [targetFieldId, setTargetFieldId] = useState('');
  const [linkType, setLinkType] = useState<'mirror' | 'reference'>('mirror');

  // Fetch target item's field defs for the field picker
  const { data: targetItem } = useItem(targetItemId || null);

  const handleCreate = async () => {
    if (!targetItemId || !sourceFieldId || !targetFieldId) return;
    const req: CreateLinkRequest = {
      target_item_id: targetItemId,
      source_field_def_id: sourceFieldId,
      target_field_def_id: targetFieldId,
      link_type: linkType,
    };
    await createLink.mutateAsync(req);
    setDialogOpen(false);
    setTargetItemId('');
    setSourceFieldId('');
    setTargetFieldId('');
    setLinkType('mirror');
  };

  if (isLoading) {
    return (
      <div className="p-4 text-sm text-muted-foreground animate-pulse">
        Bağlantılar yükleniyor…
      </div>
    );
  }

  return (
    <div className="space-y-4 p-1">
      {/* E2E note */}
      <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-200">
        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <strong>Mirror bağlantılar:</strong> Kaynak alan değiştiğinde hedef
          item'ı güncellemeniz gerekir. Şifreleme istemci tarafında yapılır,
          sunucu alan değerlerini göremez.
        </span>
      </div>

      {/* Link list */}
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Henüz bağlantı yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-medium truncate">
                  {link.target_item_name || link.target_item_id}
                </span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground truncate">
                  {link.target_field_def_name || link.target_field_def_id}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge
                  variant={link.link_type === 'mirror' ? 'default' : 'secondary'}
                  className="text-xs"
                >
                  {link.link_type === 'mirror' ? 'Mirror' : 'Referans'}
                </Badge>
                {canWrite && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => deleteLink.mutate(link.id)}
                    disabled={deleteLink.isPending}
                    title="Bağlantıyı kaldır"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Add link button */}
      {canWrite && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDialogOpen(true)}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Bağlantı Ekle
        </Button>
      )}

      {/* Create link dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bağlantı Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Link type */}
            <div className="space-y-1.5">
              <Label>Bağlantı tipi</Label>
              <Select
                value={linkType}
                onValueChange={(v) => setLinkType(v as 'mirror' | 'reference')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mirror">
                    Mirror — alan değişince hedef güncellenir
                  </SelectItem>
                  <SelectItem value="reference">
                    Referans — sadece görsel bağlantı
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Source field */}
            <div className="space-y-1.5">
              <Label>Kaynak alan (bu item'dan)</Label>
              <Select value={sourceFieldId} onValueChange={setSourceFieldId}>
                <SelectTrigger>
                  <SelectValue placeholder="Alan seçin…" />
                </SelectTrigger>
                <SelectContent>
                  {fieldDefs.map((fd) => (
                    <SelectItem key={fd.id} value={fd.id}>
                      {fd.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target item */}
            <div className="space-y-1.5">
              <Label>Hedef item ID</Label>
              <Input
                placeholder="Item UUID'sini yapıştırın…"
                value={targetItemId}
                onChange={(e) => {
                  setTargetItemId(e.target.value.trim());
                  setTargetFieldId('');
                }}
              />
              {targetItem && (
                <p className="text-xs text-muted-foreground">
                  ✓ {(targetItem as any).name ?? targetItemId}
                </p>
              )}
            </div>

            {/* Target field */}
            {targetItem && (
              <div className="space-y-1.5">
                <Label>Hedef alan</Label>
                <Select value={targetFieldId} onValueChange={setTargetFieldId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Hedef alanı seçin…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(targetItem as any).fields?.map((f: any) => (
                      <SelectItem
                        key={f.field_definition_id}
                        value={String(f.field_definition_id)}
                      >
                        {f.field_label ?? f.field_definition_id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              İptal
            </Button>
            <Button
              onClick={handleCreate}
              disabled={
                !targetItemId ||
                !sourceFieldId ||
                !targetFieldId ||
                createLink.isPending
              }
            >
              {createLink.isPending ? 'Ekleniyor…' : 'Ekle'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
