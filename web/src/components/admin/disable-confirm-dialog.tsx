/**
 * DisableConfirmDialog — kullanıcıyı devre dışı bırakma onay dialog'u.
 *
 * Server `users.status='disabled'` + tüm aktif sessionları RevokeAllUserSessions
 * ile revoke ediyor. Bu yıkıcı (geri alınabilir ama kullanıcı için kesinti
 * yaratan) bir aksiyon olduğundan onay zorunlu.
 */

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

interface DisableConfirmDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  username: string;
  onConfirm(): void;
  isPending?: boolean;
}

export function DisableConfirmDialog({
  open,
  onOpenChange,
  username,
  onConfirm,
  isPending,
}: DisableConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kullanıcıyı devre dışı bırak?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium text-foreground">{username}</span> hesabı devre dışı
            bırakılacak ve kullanıcının tüm aktif oturumları kapatılacak. Daha sonra
            "Etkinleştir" ile geri açabilirsiniz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>İptal</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isPending ? 'Uygulanıyor…' : 'Devre Dışı Bırak'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
