/**
 * ShareLinkDialog — PR-N5: One-time share link creation + management.
 *
 * Crypto flow (client-side, E2E-safe):
 *   1. Re-open item DEK from owner_dek_wrapped with user's private key.
 *   2. Generate a random 32-byte link_key.
 *   3. Wrap item DEK with link_key using AES-256-GCM (versioned blob).
 *   4. POST dek_wrapped (base64) to the server.
 *   5. Server returns raw token; construct URL with link_key in fragment.
 *
 * The link_key NEVER reaches the server (it lives only in the URL fragment).
 * The server stores only SHA-256(token) and the opaque dek_wrapped blob.
 */

import { useState } from 'react';
import { Copy, ExternalLink, Link2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth';
import {
  fromBase64,
  toBase64,
  openDEKWithKEK,
  encryptPrivateKey,
} from '@/lib/crypto';
import {
  useCreateShareLinkMutation,
  useShareLinksQuery,
  useRevokeShareLinkMutation,
} from '@/api/share-links';
import type { Item } from '@/api/types';
import { RelativeTime } from '@/components/common/relative-time';
import { userFriendlyError } from '@/lib/user-error';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Uint8Array → URL-safe base64 (no padding) for the URL fragment. */
function toBase64url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function buildShareURL(token: string, linkKey: Uint8Array): string {
  const base = `${window.location.origin}/share/${token}`;
  const fragment = toBase64url(linkKey);
  return `${base}#${fragment}`;
}

// ── component ─────────────────────────────────────────────────────────────────

interface ShareLinkDialogProps {
  item: Item;
}

export function ShareLinkDialog({ item }: ShareLinkDialogProps) {
  const [open, setOpen] = useState(false);
  const [expiresIn, setExpiresIn] = useState<'1h' | '1d' | '7d'>('1d');
  const [viewLimit, setViewLimit] = useState<number>(1);
  const [creating, setCreating] = useState(false);
  const [generatedURL, setGeneratedURL] = useState<string | null>(null);

  const privateKey = useAuthStore((s) => s.privateKey);
  const { toast } = useToast();

  const linksQuery = useShareLinksQuery(open ? item.id : null);
  const createMut = useCreateShareLinkMutation(item.id);
  const revokeMut = useRevokeShareLinkMutation(item.id);

  async function handleCreate() {
    if (!privateKey) {
      toast({ title: 'Oturum anahtarı yok', description: 'Lütfen tekrar giriş yapın.', variant: 'destructive' });
      return;
    }
    if (!item.owner_dek_wrapped || !item.owner_wrap_nonce) {
      toast({ title: 'DEK bilgisi eksik', description: 'Item DEK bilgisi sunucudan gelmedi.', variant: 'destructive' });
      return;
    }

    setCreating(true);
    setGeneratedURL(null);

    try {
      // 1. Re-open item DEK with user's private key.
      const wrapped = fromBase64(item.owner_dek_wrapped);
      const wrapNonce = fromBase64(item.owner_wrap_nonce);
      const dek = await openDEKWithKEK(wrapped, wrapNonce, privateKey);

      // 2. Generate a random 32-byte link_key.
      const linkKey = crypto.getRandomValues(new Uint8Array(32));

      // 3. Wrap item DEK with link_key (AES-256-GCM versioned blob).
      const dekWrappedBytes = await encryptPrivateKey(dek, linkKey);
      const dekWrappedB64 = toBase64(dekWrappedBytes);

      // 4. POST to server.
      const result = await createMut.mutateAsync({
        dek_wrapped: dekWrappedB64,
        expires_in: expiresIn,
        view_limit: viewLimit,
      });

      // 5. Build URL with link_key in fragment (never sent to server).
      const shareURL = buildShareURL(result.token, linkKey);
      setGeneratedURL(shareURL);
    } catch (err) {
      toast({
        title: 'Link oluşturulamadı',
        description: userFriendlyError(err),
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(linkId: string) {
    try {
      await revokeMut.mutateAsync(linkId);
      toast({ title: 'Link iptal edildi' });
    } catch {
      toast({ title: 'Link iptal edilemedi', variant: 'destructive' });
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Kopyalandı!' });
    } catch {
      toast({ title: 'Kopyalanamadı', variant: 'destructive' });
    }
  }

  const activeLinks = linksQuery.data?.links ?? [];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setGeneratedURL(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Link2 className="h-3.5 w-3.5" aria-hidden />
          Paylaşım Linki
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Paylaşım Linki Oluştur</DialogTitle>
          <DialogDescription>
            Şifreli bir link oluşturun. Alıcı giriş yapmadan içeriği görebilir.
            Link anahtarı hiçbir zaman sunucuya gönderilmez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Options */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="expires-in">Geçerlilik süresi</Label>
              <Select
                value={expiresIn}
                onValueChange={(v) => setExpiresIn(v as '1h' | '1d' | '7d')}
              >
                <SelectTrigger id="expires-in">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">1 saat</SelectItem>
                  <SelectItem value="1d">1 gün</SelectItem>
                  <SelectItem value="7d">7 gün</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-limit">Maksimum görüntüleme</Label>
              <Select
                value={String(viewLimit)}
                onValueChange={(v) => setViewLimit(Number(v))}
              >
                <SelectTrigger id="view-limit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} kez
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={handleCreate}
            disabled={creating || !privateKey}
          >
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {creating ? 'Oluşturuluyor…' : 'Yeni Link Oluştur'}
          </Button>

          {!privateKey && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Oturum anahtarı bulunamadı. Lütfen tekrar giriş yapın.
            </p>
          )}

          {/* Generated URL */}
          {generatedURL && (
            <div className="space-y-2">
              <Label>Oluşturulan link</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={generatedURL}
                  className="font-mono text-xs"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <Button
                  size="icon"
                  variant="outline"
                  title="Kopyala"
                  onClick={() => copyToClipboard(generatedURL)}
                >
                  <Copy className="h-4 w-4" aria-hidden />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  title="Yeni sekmede aç"
                  onClick={() => window.open(generatedURL, '_blank', 'noopener')}
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Bu linki yalnızca güvendiğiniz kişilerle paylaşın.
                Link, URL içindeki anahtar sayesinde şifresiz görüntülenebilir.
              </p>
            </div>
          )}

          {/* Active links list */}
          {activeLinks.length > 0 && (
            <>
              <hr className="border-border" />
              <div className="space-y-2">
                <p className="text-sm font-medium">Aktif linkler ({activeLinks.length})</p>
                <ul className="space-y-2">
                  {activeLinks.map((link) => (
                    <li
                      key={link.id}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="text-muted-foreground">
                          Oluşturulma: <RelativeTime iso={link.created_at} />
                        </div>
                        <div className="text-muted-foreground">
                          Bitiş: <RelativeTime iso={link.expires_at} />
                        </div>
                        <div className="text-muted-foreground">
                          {link.view_count} / {link.view_limit} görüntüleme
                        </div>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="İptal et"
                        disabled={revokeMut.isPending}
                        onClick={() => handleRevoke(link.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}

          {linksQuery.isLoading && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Linkler yükleniyor…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
