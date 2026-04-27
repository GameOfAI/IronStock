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
import { useDeleteFolderMutation } from '@/api/folders';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folder: { id: string; name: string; parent_id?: string | null } | null;
  onDeleted?: () => void;
}

export function FolderDeleteDialog({ open, onOpenChange, folder, onDeleted }: Props) {
  const mutation = useDeleteFolderMutation();

  async function handleConfirm() {
    if (!folder) return;
    await mutation.mutateAsync({ id: folder.id, parentId: folder.parent_id ?? null });
    onOpenChange(false);
    onDeleted?.();
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Klasörü Sil</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{folder?.name}</strong> klasörünü silmek istediğinize emin misiniz? Bu işlem
            geri alınamaz. İçindeki alt klasörler ve item'lar da silinir.
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
