import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUserPublicKey } from '@/api/catalog';
import { useShareItemMutation } from '@/api/items';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: { id: string; name: string } | null;
}

export function ItemShareModal({ open, onOpenChange, item }: Props) {
  const [recipientId, setRecipientId] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [error, setError] = useState<string | null>(null);

  const pubKeyQuery = useUserPublicKey(recipientId.trim() || null);
  const shareMutation = useShareItemMutation(item?.id ?? '');
  const isPending = shareMutation.isPending;

  function handleClose() {
    setRecipientId('');
    setPermission('read');
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const uid = recipientId.trim();
    if (!uid) {
      setError('Kullanıcı ID gerekli');
      return;
    }
    if (!pubKeyQuery.data) {
      setError('Alıcının public key\'i alınamadı. Kullanıcı ID\'sini kontrol edin.');
      return;
    }

    try {
      // DEK re-wrap için owner DEK'e erişim gerekiyor.
      // Server şu an itemResponse'a owner_dek_wrapped + wrap_nonce eklemiyor.
      // Bu özellik sunucu tarafı güncellenmesi sonrasında aktif edilecek.
      throw new Error(
        'Paylaşım için sunucu tarafında owner_dek_wrapped alanı gerekiyor. ' +
          'Bu alan henüz itemResponse\'a eklenmedi (Win tarafı güncel değil).',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bir hata oluştu');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Item Paylaş — {item?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            Paylaşım için sunucu tarafında <code>owner_dek_wrapped</code> alanı gereklidir. Bu
            alan henüz itemResponse&apos;a eklenmedi — Win session&apos;da
            item_handlers.go&apos;ya eklenmesi bekleniyor.
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="recipient-id">Kullanıcı ID</Label>
            <Input
              id="recipient-id"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              placeholder="UUID"
              disabled={isPending}
            />
            {pubKeyQuery.isSuccess && (
              <p className="text-xs text-muted-foreground">
                ✓ Kullanıcı bulundu, public key hazır
              </p>
            )}
            {pubKeyQuery.isError && recipientId.trim() && (
              <p className="text-xs text-destructive">Kullanıcı bulunamadı</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="share-permission">Yetki</Label>
            <Select
              value={permission}
              onValueChange={(v) => setPermission(v as 'read' | 'write')}
              disabled={isPending}
            >
              <SelectTrigger id="share-permission">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">Okuma</SelectItem>
                <SelectItem value="write">Yazma</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              İptal
            </Button>
            <Button type="submit" disabled={isPending}>
              Paylaş
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
