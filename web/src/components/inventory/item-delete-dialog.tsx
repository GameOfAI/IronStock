import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Item&apos;ı Sil</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{item?.name}</strong> item&apos;ını kalıcı olarak silmek istediğinize emin
            misiniz? Bu işlem geri alınamaz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>İptal</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={mutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Sil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
