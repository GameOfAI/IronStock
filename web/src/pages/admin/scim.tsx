/**
 * AdminSCIMPage — SCIM 2.0 provisioning configuration (PR-SCIM).
 *
 * Lets admins:
 *   - View the SCIM base URL to configure in Azure AD / Okta
 *   - Create a SCIM bearer token (scope='scim')
 *   - View and revoke existing SCIM tokens
 *   - See recent provisioning events from audit log
 */

import { useState } from 'react';
import {
  Copy, Check, Plus, Trash2, Loader2, Shield, Eye, EyeOff, RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/cn';
import {
  useAPITokensQuery,
  useCreateAPITokenMutation,
  useDeleteAPITokenMutation,
  type APIToken,
} from '@/api/api-tokens';
import { useDocumentTitle } from '@/hooks/use-document-title';

// SCIM base URL (same origin as the API).
const scimBaseURL = `${window.location.origin}/scim/v2`;

export default function AdminSCIMPage() {
  useDocumentTitle('SCIM Provisioning');
  const { toast } = useToast();
  const { data, isLoading, refetch } = useAPITokensQuery();
  const createToken = useCreateAPITokenMutation();
  const deleteToken = useDeleteAPITokenMutation();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<APIToken | null>(null);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const scimTokens = (data?.tokens ?? []).filter((t) => t.scope === 'scim');

  async function copyToClipboard(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: 'Kopyalanamadı', variant: 'destructive' });
    }
  }

  async function handleCreate() {
    if (!newTokenName.trim()) return;
    try {
      const result = await createToken.mutateAsync({
        name: newTokenName.trim(),
        scope: 'scim',
      });
      if (result.token) {
        setNewTokenValue(result.token);
        setShowToken(false);
      } else {
        setShowCreateModal(false);
        setNewTokenName('');
        toast({ title: 'Token oluşturuldu' });
      }
    } catch {
      toast({ title: 'Token oluşturulamadı', variant: 'destructive' });
    }
  }

  function handleCreateClose() {
    setShowCreateModal(false);
    setNewTokenName('');
    setNewTokenValue(null);
    setShowToken(false);
  }

  async function handleDelete(id: string) {
    try {
      await deleteToken.mutateAsync(id);
      setDeleteTarget(null);
      toast({ title: 'Token silindi' });
    } catch {
      toast({ title: 'Token silinemedi', variant: 'destructive' });
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">SCIM 2.0 Provisioning</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Azure AD, Okta veya başka bir IdP'yi IronStock'a bağlayarak kullanıcı
          ve grup senkronizasyonunu otomatikleştirin.
        </p>
      </div>

      {/* SCIM URL card */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-semibold">SCIM Tenant URL</h2>
        <p className="text-sm text-muted-foreground">
          IdP ayarlarında "SCIM Connector Base URL" veya "Tenant URL" alanına
          bu değeri girin.
        </p>
        <div className="flex gap-2">
          <Input readOnly value={scimBaseURL} className="font-mono text-sm" />
          <Button
            variant="outline"
            size="icon"
            onClick={() => copyToClipboard(scimBaseURL, 'url')}
            aria-label="URL'yi kopyala"
          >
            {copiedField === 'url' ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>

        <h2 className="font-semibold pt-2">ServiceProviderConfig URL</h2>
        <p className="text-sm text-muted-foreground">
          Bazı IdP'ler kabiliyetleri otomatik keşfetmek için bu endpoint'i kullanır.
        </p>
        <div className="flex gap-2">
          <Input
            readOnly
            value={`${scimBaseURL}/ServiceProviderConfig`}
            className="font-mono text-sm"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => copyToClipboard(`${scimBaseURL}/ServiceProviderConfig`, 'spconfig')}
            aria-label="ServiceProviderConfig URL'yi kopyala"
          >
            {copiedField === 'spconfig' ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </section>

      {/* SCIM tokens */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">SCIM Bearer Token'ları</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              IdP'nin "API Token" veya "Bearer Token" alanına yapıştırın.
              Token yalnızca oluşturulduğu an görünür.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} aria-label="Yenile">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Token Oluştur
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : scimTokens.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            <Shield className="mx-auto mb-2 h-8 w-8 opacity-40" />
            Henüz SCIM token'ı yok. Yeni token oluşturun ve IdP'nize ekleyin.
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {scimTokens.map((token) => (
              <div key={token.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-sm">{token.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Oluşturuldu: {new Date(token.created_at).toLocaleDateString('tr-TR')}
                    {token.last_used_at && (
                      <> · Son kullanım: {new Date(token.last_used_at).toLocaleDateString('tr-TR')}</>
                    )}
                    {token.expires_at && (
                      <> · Son geçerlilik: {new Date(token.expires_at).toLocaleDateString('tr-TR')}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(token)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Protocol info */}
      <section className="rounded-lg border border-dashed p-6 space-y-2">
        <h2 className="font-semibold text-sm">Desteklenen SCIM Operasyonları</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-muted-foreground">
          <p>✓ Kullanıcı oluşturma (POST /Users)</p>
          <p>✓ Kullanıcı güncelleme (PATCH /Users/:id)</p>
          <p>✓ Kullanıcı devre dışı bırakma (active=false)</p>
          <p>✓ Kullanıcı listeleme + filtre</p>
          <p>✓ Grup oluşturma (POST /Groups)</p>
          <p>✓ Grup üye yönetimi (PATCH /Groups/:id)</p>
          <p>✓ ServiceProviderConfig</p>
          <p className="text-muted-foreground/60">– Hard delete yok (audit koruması)</p>
        </div>
      </section>

      {/* Create token modal */}
      <Dialog open={showCreateModal} onOpenChange={(o) => !o && handleCreateClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SCIM Token Oluştur</DialogTitle>
          </DialogHeader>
          {newTokenValue ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
                Bu token yalnızca <strong>bir kez</strong> gösterilir.
                Hemen kopyalayıp IdP ayarlarınıza yapıştırın.
              </div>
              <div className="space-y-1">
                <Label>Bearer Token</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={showToken ? newTokenValue : '••••••••••••••••••••••••••••••'}
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowToken((v) => !v)}
                    aria-label={showToken ? 'Gizle' : 'Göster'}
                  >
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => copyToClipboard(newTokenValue, 'newtoken')}
                    aria-label="Kopyala"
                  >
                    {copiedField === 'newtoken' ? (
                      <Check className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleCreateClose}>Tamam, kopyaladım</Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="token-name">Token Adı</Label>
                <Input
                  id="token-name"
                  placeholder="örn. Azure AD Prod"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCreateClose}>İptal</Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newTokenName.trim() || createToken.isPending}
                >
                  {createToken.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Oluştur
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Token'ı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> token'ı silinecek. Bu işlem geri alınamaz.
              IdP senkronizasyonu bu token'ı kullanıyorsa durur.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className={cn('bg-destructive text-destructive-foreground hover:bg-destructive/90')}
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              {deleteToken.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Sil'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
