import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeleteItemMutation } from '@/api/items';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: { id: string; name: string } | null;
  folderId: string;
  onDeleted?: () => void;
}

export function ItemDeleteDialog({ open, onOpenChange, item, folderId, onDeleted }: Props) {
  const mutation = useDeleteItemMutation(folderId);

  async function handleConfirm() {
    if (!item) return;
    await mutation.mutateAsync(item.id);
    onOpenChange(false);
    onDeleted?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Item&apos;ı Sil</DialogTitle>
          <DialogDescription>
            <strong>{item?.name}</strong> item&apos;ını kalıcı olarak silmek istediğinize emin
            misiniz? Bu işlem geri alınamaz.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            İptal
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Siliniyor…' : 'Sil'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
