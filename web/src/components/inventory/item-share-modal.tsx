/**
 * ItemShareModal — share an item with another user (PR-UX5, PR-TIME).
 *
 * Flow:
 * 1. Owner's `owner_dek_wrapped` + `owner_wrap_nonce` → openDEKWithKEK → plaintext DEK
 * 2. Fetch recipient's public key via `useUserPublicKey(recipientId)`
 * 3. Seal DEK with recipient's X25519 public key → `sealDEK`
 * 4. POST /items/{id}/shares { user_id, permission, dek_wrapped, wrap_nonce,
 *                              valid_from?, valid_until? }
 */

import { useState } from 'react';
import { Calendar, Loader2, Search, Share2 } from 'lucide-react';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useUserPublicKey } from '@/api/catalog';
import { useShareItemMutation } from '@/api/items';
import { useUsers } from '@/api/admin';
import { useAuthStore } from '@/store/auth';
import { fromBase64, toBase64, openDEKWithKEK, sealDEK } from '@/lib/crypto';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: {
    id: string;
    name: string;
    owner_dek_wrapped?: string;
    owner_wrap_nonce?: string;
  } | null;
}

export function ItemShareModal({ open, onOpenChange, item }: Props) {
  const [recipientId, setRecipientId] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  const privateKey = useAuthStore((s) => s.privateKey);
  const pubKeyQuery = useUserPublicKey(recipientId || null);
  const shareMutation = useShareItemMutation(item?.id ?? '');
  const usersQuery = useUsers({ limit: 200, offset: 0 });
  const isPending = shareMutation.isPending;

  const allUsers = usersQuery.data?.users ?? [];
  const me = useAuthStore((s) => s.user);
  const filteredUsers = allUsers.filter((u) => {
    if (u.id === me?.id) return false; // can't share with self
    if (!userSearch) return true;
    const q = userSearch.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q)
    );
  });

  function handleClose() {
    setRecipientId('');
    setRecipientName('');
    setPermission('read');
    setValidFrom('');
    setValidUntil('');
    setError(null);
    onOpenChange(false);
  }

  function selectUser(userId: string, username: string) {
    setRecipientId(userId);
    setRecipientName(username);
    setUserPickerOpen(false);
    setUserSearch('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!recipientId) {
      setError('Bir kullanıcı seçin.');
      return;
    }
    // PR-TIME: validate time window
    if (validFrom && validUntil && new Date(validFrom) >= new Date(validUntil)) {
      setError('Başlangıç tarihi bitiş tarihinden önce olmalı.');
      return;
    }
    if (!privateKey) {
      setError('Şifreleme anahtarı bulunamadı. Yeniden giriş yapın.');
      return;
    }
    if (!item?.owner_dek_wrapped || !item?.owner_wrap_nonce) {
      setError('Bu item için owner DEK bilgisi mevcut değil. Item detayını yeniden yükleyin.');
      return;
    }
    if (!pubKeyQuery.data) {
      setError('Alıcının public key\'i alınamadı.');
      return;
    }

    try {
      // 1. Unwrap owner's DEK
      const dek = await openDEKWithKEK(
        fromBase64(item.owner_dek_wrapped),
        fromBase64(item.owner_wrap_nonce),
        privateKey,
      );

      // 2. Seal DEK with recipient's public key
      const recipientPubKey = fromBase64(pubKeyQuery.data.public_key);
      const { wrapped, nonce } = await sealDEK(dek, recipientPubKey);

      // 3. POST share (PR-TIME: include optional time window)
      await shareMutation.mutateAsync({
        user_id: recipientId,
        permission,
        dek_wrapped: toBase64(wrapped),
        wrap_nonce: toBase64(nonce),
        valid_from: validFrom ? new Date(validFrom).toISOString() : null,
        valid_until: validUntil ? new Date(validUntil).toISOString() : null,
      });

      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paylaşım sırasında hata oluştu.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Item Paylaş — {item?.name}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* User picker */}
          <div className="space-y-1.5">
            <Label>Kullanıcı</Label>
            <Popover open={userPickerOpen} onOpenChange={setUserPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start font-normal"
                  disabled={isPending}
                >
                  {recipientName ? (
                    <span>{recipientName}</span>
                  ) : (
                    <span className="text-muted-foreground">Kullanıcı seç…</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="start">
                <div className="flex items-center gap-2 mb-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Kullanıcı ara…"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="h-7 text-xs"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {usersQuery.isLoading ? (
                    <div className="flex justify-center py-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      Kullanıcı bulunamadı
                    </p>
                  ) : (
                    filteredUsers.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left hover:bg-accent transition-colors"
                        onClick={() => selectUser(u.id, u.username)}
                      >
                        <span className="text-sm font-medium">{u.username}</span>
                        <span className="text-[10px] text-muted-foreground">{u.email}</span>
                      </button>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
            {pubKeyQuery.isSuccess && recipientId && (
              <p className="text-xs text-muted-foreground">
                ✓ Public key hazır
              </p>
            )}
            {pubKeyQuery.isError && recipientId && (
              <p className="text-xs text-destructive">
                Public key alınamadı — kullanıcıda anahtar eksik olabilir.
              </p>
            )}
          </div>

          {/* Permission */}
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

          {/* PR-TIME: Optional time window */}
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5 text-sm">
              <Calendar className="h-3.5 w-3.5" />
              Erişim Penceresi
              <span className="text-xs text-muted-foreground font-normal">(opsiyonel)</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="share-valid-from" className="text-xs text-muted-foreground">
                  Başlangıç
                </Label>
                <Input
                  id="share-valid-from"
                  type="datetime-local"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  disabled={isPending}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="share-valid-until" className="text-xs text-muted-foreground">
                  Bitiş
                </Label>
                <Input
                  id="share-valid-until"
                  type="datetime-local"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  disabled={isPending}
                  className="text-xs"
                />
              </div>
            </div>
            {(validFrom || validUntil) && (
              <p className="text-xs text-muted-foreground">
                {validFrom && validUntil
                  ? `${new Date(validFrom).toLocaleString('tr-TR')} — ${new Date(validUntil).toLocaleString('tr-TR')}`
                  : validFrom
                  ? `${new Date(validFrom).toLocaleString('tr-TR')} tarihinden itibaren`
                  : `${new Date(validUntil).toLocaleString('tr-TR')} tarihine kadar`}
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              İptal
            </Button>
            <Button
              type="submit"
              disabled={isPending || !recipientId || pubKeyQuery.isPending}
            >
              {isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Paylaşılıyor…
                </>
              ) : (
                'Paylaş'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
