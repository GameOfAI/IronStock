import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateFolderMutation, useUpdateFolderMutation } from '@/api/folders';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, we're renaming an existing folder. */
  editFolder?: { id: string; name: string; parent_id?: string | null };
  /** Pre-fill parent when creating inside a folder. */
  parentId?: string | null;
}

export function FolderFormModal({ open, onOpenChange, editFolder, parentId }: Props) {
  const [name, setName] = useState('');

  const createMutation = useCreateFolderMutation();
  const updateMutation = useUpdateFolderMutation(editFolder?.id ?? '');

  const isEdit = Boolean(editFolder);
  const isPending = createMutation.isPending || updateMutation.isPending;
  const error = createMutation.error ?? updateMutation.error;

  useEffect(() => {
    if (open) setName(editFolder?.name ?? '');
  }, [open, editFolder]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (isEdit && editFolder) {
        await updateMutation.mutateAsync({
          name: trimmed,
          parent_id: editFolder.parent_id,
        });
      } else {
        await createMutation.mutateAsync({
          name: trimmed,
          parent_id: parentId ?? null,
        });
      }
      onOpenChange(false);
    } catch {
      // error displayed below
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Klasörü Yeniden Adlandır' : 'Yeni Klasör'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="folder-name">Klasör Adı</Label>
            <Input
              id="folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Klasör adı"
              autoFocus
              disabled={isPending}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : 'Bir hata oluştu'}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isEdit ? 'Kaydet' : 'Oluştur'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
