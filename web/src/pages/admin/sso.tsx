/**
 * AdminSSOPage — SSO/LDAP provider configuration (PR-LDAP).
 *
 * Admins can add, edit, delete and test OIDC / LDAP SSO providers.
 * Each provider is either:
 *   OIDC — OpenID Connect (Azure AD, Okta, Google Workspace …)
 *   LDAP — Active Directory / OpenLDAP bind authentication
 */

import { useState } from 'react';
import {
  Plus, Pencil, Trash2, RefreshCw, Loader2, Check, X,
  Shield, Network, ChevronDown, ChevronUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/cn';
import type { SSOProvider, CreateSSOProviderRequest } from '@/api/types';
import {
  useAdminSSOProvidersQuery,
  useCreateSSOProviderMutation,
  useUpdateSSOProviderMutation,
  useDeleteSSOProviderMutation,
  useTestLDAPConnectionMutation,
} from '@/api/admin-sso';

// ─── Empty default for the form ───────────────────────────────────────────────

const defaultForm = (): CreateSSOProviderRequest => ({
  name: '',
  provider_type: 'ldap',
  enabled: true,
  auto_provision: true,
  default_role: 'read',
  discovery_url: '',
  client_id: '',
  client_secret: '',
  scopes: ['openid', 'email', 'profile'],
  ldap_url: '',
  ldap_bind_dn: '',
  ldap_bind_password: '',
  ldap_user_search_base: '',
  ldap_user_filter: '(uid={username})',
  ldap_attr_username: 'uid',
  ldap_attr_email: 'mail',
  ldap_attr_display_name: 'cn',
  ldap_use_starttls: false,
  ldap_skip_tls_verify: false,
});

// ─── Provider badge ───────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const isOIDC = type === 'oidc';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      isOIDC
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
        : 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
    )}>
      {isOIDC ? <Shield className="h-3 w-3" /> : <Network className="h-3 w-3" />}
      {isOIDC ? 'OIDC' : 'LDAP'}
    </span>
  );
}

// ─── Provider form dialog ─────────────────────────────────────────────────────

function ProviderFormDialog({
  existing,
  onClose,
}: {
  existing?: SSOProvider;
  onClose: () => void;
}) {
  const isEdit = !!existing;
  const [form, setForm] = useState<CreateSSOProviderRequest>(
    existing
      ? {
          name: existing.name,
          provider_type: existing.provider_type,
          enabled: existing.enabled,
          auto_provision: existing.auto_provision,
          default_role: existing.default_role,
          discovery_url: existing.discovery_url ?? '',
          client_id: existing.client_id ?? '',
          client_secret: '', // never pre-fill
          scopes: existing.scopes ?? ['openid', 'email', 'profile'],
          ldap_url: existing.ldap_url ?? '',
          ldap_bind_dn: existing.ldap_bind_dn ?? '',
          ldap_bind_password: '',
          ldap_user_search_base: existing.ldap_user_search_base ?? '',
          ldap_user_filter: existing.ldap_user_filter ?? '(uid={username})',
          ldap_attr_username: existing.ldap_attr_username ?? 'uid',
          ldap_attr_email: existing.ldap_attr_email ?? 'mail',
          ldap_attr_display_name: existing.ldap_attr_display_name ?? 'cn',
          ldap_use_starttls: existing.ldap_use_starttls,
          ldap_skip_tls_verify: existing.ldap_skip_tls_verify,
        }
      : defaultForm(),
  );

  const [showAdvanced, setShowAdvanced] = useState(false);
  const createMut = useCreateSSOProviderMutation();
  const updateMut = useUpdateSSOProviderMutation(existing?.id ?? '');
  const { toast } = useToast();

  const isPending = createMut.isPending || updateMut.isPending;

  const set = <K extends keyof CreateSSOProviderRequest>(k: K, v: CreateSSOProviderRequest[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  async function handleSubmit() {
    try {
      if (isEdit) {
        await updateMut.mutateAsync(form);
      } else {
        await createMut.mutateAsync(form);
      }
      toast({ title: isEdit ? 'Sağlayıcı güncellendi' : 'Sağlayıcı oluşturuldu' });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
      toast({ title: 'Hata', description: msg, variant: 'destructive' });
    }
  }

  const isLDAP = form.provider_type === 'ldap';
  const isOIDC = form.provider_type === 'oidc';

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Sağlayıcıyı Düzenle' : 'Yeni SSO Sağlayıcı'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Common */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>İsim</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="Azure AD" />
            </div>
            <div className="space-y-1.5">
              <Label>Tür</Label>
              <Select value={form.provider_type}
                onValueChange={(v) => set('provider_type', v as 'oidc' | 'ldap')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="oidc">OIDC (Azure AD, Okta …)</SelectItem>
                  <SelectItem value="ldap">LDAP / Active Directory</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch checked={form.enabled} onCheckedChange={(v) => set('enabled', v)} />
              <Label>Etkin</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.auto_provision}
                onCheckedChange={(v) => set('auto_provision', v)} />
              <Label>Otomatik kullanıcı oluştur</Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Varsayılan Rol</Label>
            <Select value={form.default_role} onValueChange={(v) => set('default_role', v)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="read">read</SelectItem>
                <SelectItem value="write">write</SelectItem>
                <SelectItem value="admin">admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* OIDC fields */}
          {isOIDC && (
            <>
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                  OpenID Connect
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Discovery URL</Label>
                <Input value={form.discovery_url ?? ''}
                  onChange={(e) => set('discovery_url', e.target.value)}
                  placeholder="https://login.microsoftonline.com/{tenant}/v2.0" />
                <p className="text-xs text-muted-foreground">
                  /.well-known/openid-configuration endpoint'i oluşturan taban URL.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input value={form.client_id ?? ''} onChange={(e) => set('client_id', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Secret {isEdit && '(değiştirmek için girin)'}</Label>
                  <Input type="password" value={form.client_secret ?? ''}
                    onChange={(e) => set('client_secret', e.target.value)}
                    placeholder={isEdit ? '(değiştirilmedi)' : ''} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Scopes (boşlukla ayrılmış)</Label>
                <Input
                  value={(form.scopes ?? []).join(' ')}
                  onChange={(e) => set('scopes', e.target.value.split(' ').filter(Boolean))}
                  placeholder="openid email profile" />
              </div>
            </>
          )}

          {/* LDAP fields */}
          {isLDAP && (
            <>
              <div className="border-t pt-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                  LDAP / Active Directory
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>LDAP URL</Label>
                <Input value={form.ldap_url ?? ''}
                  onChange={(e) => set('ldap_url', e.target.value)}
                  placeholder="ldap://ldap.example.com:389" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Servis Hesabı DN</Label>
                  <Input value={form.ldap_bind_dn ?? ''}
                    onChange={(e) => set('ldap_bind_dn', e.target.value)}
                    placeholder="cn=service,dc=example,dc=com" />
                </div>
                <div className="space-y-1.5">
                  <Label>Servis Şifresi {isEdit && '(değiştirmek için girin)'}</Label>
                  <Input type="password" value={form.ldap_bind_password ?? ''}
                    onChange={(e) => set('ldap_bind_password', e.target.value)}
                    placeholder={isEdit ? '(değiştirilmedi)' : ''} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Kullanıcı Arama Tabanı</Label>
                <Input value={form.ldap_user_search_base ?? ''}
                  onChange={(e) => set('ldap_user_search_base', e.target.value)}
                  placeholder="dc=example,dc=com" />
              </div>
              <div className="space-y-1.5">
                <Label>Kullanıcı Filtresi</Label>
                <Input value={form.ldap_user_filter ?? ''}
                  onChange={(e) => set('ldap_user_filter', e.target.value)}
                  placeholder="(uid={username})" />
                <p className="text-xs text-muted-foreground">
                  {"{"}"{"username}{"}"} kullanıcının girdiği isimle değiştirilir.
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={form.ldap_use_starttls ?? false}
                    onCheckedChange={(v) => set('ldap_use_starttls', v)} />
                  <Label>StartTLS</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.ldap_skip_tls_verify ?? false}
                    onCheckedChange={(v) => set('ldap_skip_tls_verify', v)} />
                  <Label className="text-amber-600">TLS doğrulamayı atla</Label>
                </div>
              </div>

              {/* Advanced LDAP attrs */}
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                Gelişmiş öznitelik eşlemeleri
              </button>
              {showAdvanced && (
                <div className="grid grid-cols-3 gap-3 border rounded-md p-3 bg-muted/30">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Kullanıcı adı özniteliği</Label>
                    <Input className="h-7 text-xs" value={form.ldap_attr_username ?? 'uid'}
                      onChange={(e) => set('ldap_attr_username', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">E-posta özniteliği</Label>
                    <Input className="h-7 text-xs" value={form.ldap_attr_email ?? 'mail'}
                      onChange={(e) => set('ldap_attr_email', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Görünen ad özniteliği</Label>
                    <Input className="h-7 text-xs" value={form.ldap_attr_display_name ?? 'cn'}
                      onChange={(e) => set('ldap_attr_display_name', e.target.value)} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>İptal</Button>
          <Button onClick={handleSubmit} disabled={isPending || !form.name}>
            {isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEdit ? 'Kaydediliyor…' : 'Oluşturuluyor…'}</>
              : isEdit ? 'Kaydet' : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminSSOPage() {
  const { data, isLoading, refetch } = useAdminSSOProvidersQuery();
  const providers = data?.providers ?? [];

  const deleteMut = useDeleteSSOProviderMutation();
  const testMut = useTestLDAPConnectionMutation();
  const { toast } = useToast();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SSOProvider | null>(null);
  const [deleting, setDeleting] = useState<SSOProvider | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

  async function handleTest(p: SSOProvider) {
    setTestResult(null);
    try {
      const res = await testMut.mutateAsync(p.id);
      setTestResult({ id: p.id, ok: res.ok, msg: res.message ?? res.error ?? '' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Bağlantı testi başarısız';
      setTestResult({ id: p.id, ok: false, msg });
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await deleteMut.mutateAsync(deleting.id);
      toast({ title: `"${deleting.name}" silindi` });
      setDeleting(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Silme başarısız';
      toast({ title: 'Hata', description: msg, variant: 'destructive' });
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SSO / LDAP</h1>
          <p className="text-sm text-muted-foreground mt-1">
            OpenID Connect ve LDAP sağlayıcılarını yönetin. Kullanıcılar kurumsal kimlik bilgileriyle
            giriş yapabilir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Yeni Sağlayıcı
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : providers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Henüz SSO sağlayıcısı eklenmedi.</p>
          <Button variant="outline" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            İlk sağlayıcıyı ekle
          </Button>
        </div>
      ) : (
        <div className="rounded-md border divide-y">
          {providers.map((p) => (
            <div key={p.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{p.name}</span>
                    <TypeBadge type={p.provider_type} />
                    {!p.enabled && (
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        Devre dışı
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    {p.provider_type === 'oidc' && p.discovery_url && (
                      <span>🔗 {p.discovery_url}</span>
                    )}
                    {p.provider_type === 'ldap' && p.ldap_url && (
                      <span>🖥 {p.ldap_url}</span>
                    )}
                    <span>Rol: {p.default_role}</span>
                    {p.auto_provision && <span>Otomatik oluştur</span>}
                  </div>
                  {/* Test result */}
                  {testResult?.id === p.id && (
                    <div className={cn(
                      'flex items-center gap-1.5 text-xs mt-1 font-medium',
                      testResult.ok ? 'text-green-600' : 'text-red-600',
                    )}>
                      {testResult.ok
                        ? <Check className="h-3.5 w-3.5" />
                        : <X className="h-3.5 w-3.5" />}
                      {testResult.msg || (testResult.ok ? 'Bağlantı başarılı' : 'Bağlantı başarısız')}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {p.provider_type === 'ldap' && (
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => handleTest(p)}
                      disabled={testMut.isPending}>
                      {testMut.isPending && testResult?.id === p.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : 'Test'}
                    </Button>
                  )}
                  <Button variant="outline" size="icon" className="h-7 w-7"
                    onClick={() => setEditing(p)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="outline" size="icon" className="h-7 w-7 text-destructive"
                    onClick={() => setDeleting(p)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit dialog */}
      {creating && <ProviderFormDialog onClose={() => setCreating(false)} />}
      {editing && <ProviderFormDialog existing={editing} onClose={() => setEditing(null)} />}

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={() => setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sağlayıcıyı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleting?.name}</strong> sağlayıcısı silinecek. Bu sağlayıcı üzerinden giriş
              yapan kullanıcıların SSO bağlantısı da silinecek. İşlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
