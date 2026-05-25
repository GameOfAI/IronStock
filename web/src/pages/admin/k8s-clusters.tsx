/**
 * AdminK8sClustersPage — Kubernetes cluster configuration (PR-K8S).
 *
 * Admins can add, edit, delete, and connectivity-test K8s cluster configs.
 * Credentials (SA token or kubeconfig YAML) are sent once and then stored
 * encrypted; the API only returns has_token / has_kubeconfig flags.
 */

import { useState } from 'react';
import {
  Plus, Pencil, Trash2, Wifi, Loader2, Layers,
  Check, X, Eye, EyeOff, ShieldAlert,
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/cn';
import {
  useAdminK8sClustersQuery,
  useCreateK8sClusterMutation,
  useUpdateK8sClusterMutation,
  useDeleteK8sClusterMutation,
  useTestK8sClusterMutation,
  type K8sCluster,
  type CreateK8sClusterRequest,
} from '@/api/admin-k8s';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { userFriendlyError } from '@/lib/user-error';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      enabled
        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    )}>
      {enabled ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {enabled ? 'Aktif' : 'Pasif'}
    </span>
  );
}

function AuthModeBadge({ mode }: { mode: string }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
      mode === 'token'
        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
        : 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
    )}>
      {mode === 'token' ? 'SA Token' : 'Kubeconfig'}
    </span>
  );
}

// ─── Form defaults ────────────────────────────────────────────────────────────

type FormState = Omit<CreateK8sClusterRequest, 'token' | 'kubeconfig_yaml'> & {
  token: string;
  kubeconfig_yaml: string;
};

const defaultForm = (): FormState => ({
  name: '',
  server_url: '',
  auth_mode: 'token',
  token: '',
  kubeconfig_yaml: '',
  ca_cert_pem: '',
  skip_tls_verify: false,
  enabled: true,
});

// ─── Cluster Form Dialog ──────────────────────────────────────────────────────

function ClusterFormDialog({
  open,
  editTarget,
  onClose,
}: {
  open: boolean;
  editTarget: K8sCluster | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const create = useCreateK8sClusterMutation();
  const update = useUpdateK8sClusterMutation();
  const isEdit = editTarget !== null;

  const [form, setForm] = useState<FormState>(defaultForm);
  const [showToken, setShowToken] = useState(false);

  // Reset form when dialog opens.
  const handleOpenChange = (o: boolean) => {
    if (o) {
      if (editTarget) {
        setForm({
          name: editTarget.name,
          server_url: editTarget.server_url,
          auth_mode: editTarget.auth_mode,
          token: '',
          kubeconfig_yaml: '',
          ca_cert_pem: editTarget.ca_cert_pem ?? '',
          skip_tls_verify: editTarget.skip_tls_verify,
          enabled: editTarget.enabled,
        });
      } else {
        setForm(defaultForm());
      }
    } else {
      onClose();
    }
  };

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = () => {
    if (!form.name.trim()) {
      toast({ title: 'Hata', description: 'Cluster adı zorunlu.', variant: 'destructive' });
      return;
    }
    if (!form.server_url.trim()) {
      toast({ title: 'Hata', description: 'Sunucu URL zorunlu.', variant: 'destructive' });
      return;
    }
    if (form.auth_mode === 'token' && !isEdit && !form.token.trim()) {
      toast({ title: 'Hata', description: 'Token modu için token zorunlu.', variant: 'destructive' });
      return;
    }
    if (form.auth_mode === 'kubeconfig' && !isEdit && !form.kubeconfig_yaml.trim()) {
      toast({ title: 'Hata', description: 'Kubeconfig modu için kubeconfig_yaml zorunlu.', variant: 'destructive' });
      return;
    }

    const payload = {
      name: form.name.trim(),
      server_url: form.server_url.trim(),
      auth_mode: form.auth_mode,
      ca_cert_pem: form.ca_cert_pem?.trim() || undefined,
      skip_tls_verify: form.skip_tls_verify,
      enabled: form.enabled,
      ...(form.token.trim() ? { token: form.token.trim() } : {}),
      ...(form.kubeconfig_yaml.trim() ? { kubeconfig_yaml: form.kubeconfig_yaml.trim() } : {}),
    };

    const action = isEdit
      ? update.mutateAsync({ id: editTarget.id, ...payload })
      : create.mutateAsync(payload);

    action
      .then(() => {
        toast({ title: isEdit ? 'Cluster güncellendi' : 'Cluster oluşturuldu' });
        onClose();
      })
      .catch((e: Error) => {
        toast({ title: 'Hata', description: userFriendlyError(e), variant: 'destructive' });
      });
  };

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Cluster Düzenle' : 'Yeni K8s Cluster'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label>Ad *</Label>
            <Input
              placeholder="prod-cluster"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          {/* Server URL */}
          <div className="flex flex-col gap-1.5">
            <Label>Sunucu URL *</Label>
            <Input
              placeholder="https://k8s-api.example.com:6443"
              value={form.server_url}
              onChange={(e) => set('server_url', e.target.value)}
            />
          </div>

          {/* Auth Mode */}
          <div className="flex flex-col gap-1.5">
            <Label>Kimlik Doğrulama</Label>
            <Select value={form.auth_mode} onValueChange={(v) => set('auth_mode', v as 'token' | 'kubeconfig')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="token">ServiceAccount Token</SelectItem>
                <SelectItem value="kubeconfig">Kubeconfig YAML</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Token */}
          {form.auth_mode === 'token' && (
            <div className="flex flex-col gap-1.5">
              <Label>
                SA Token {isEdit && <span className="text-xs text-muted-foreground">(boş bırakın = mevcut token korunur)</span>}
              </Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder={isEdit ? '••••••••' : 'eyJhbGci…'}
                  value={form.token}
                  onChange={(e) => set('token', e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                >
                  {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
              {editTarget?.has_token && (
                <p className="text-xs text-muted-foreground">Token mevcut. Değiştirmek istemiyorsanız boş bırakın.</p>
              )}
            </div>
          )}

          {/* Kubeconfig */}
          {form.auth_mode === 'kubeconfig' && (
            <div className="flex flex-col gap-1.5">
              <Label>
                Kubeconfig YAML {isEdit && <span className="text-xs text-muted-foreground">(boş bırakın = mevcut korunur)</span>}
              </Label>
              <Textarea
                rows={8}
                placeholder={'apiVersion: v1\nkind: Config\ncurrent-context: my-cluster\n...'}
                value={form.kubeconfig_yaml}
                onChange={(e) => set('kubeconfig_yaml', e.target.value)}
                className="font-mono text-xs"
              />
              {editTarget?.has_kubeconfig && (
                <p className="text-xs text-muted-foreground">Kubeconfig mevcut. Değiştirmek istemiyorsanız boş bırakın.</p>
              )}
              <p className="text-xs text-amber-600 dark:text-amber-400">
                <ShieldAlert className="inline h-3 w-3 mr-1" />
                Desteklenen: inline base64 cert-data + token. exec auth ve dosya yolları desteklenmez.
              </p>
            </div>
          )}

          {/* CA Cert */}
          <div className="flex flex-col gap-1.5">
            <Label>CA Sertifikası (PEM) <span className="text-xs text-muted-foreground">opsiyonel</span></Label>
            <Textarea
              rows={4}
              placeholder="-----BEGIN CERTIFICATE-----\n..."
              value={form.ca_cert_pem ?? ''}
              onChange={(e) => set('ca_cert_pem', e.target.value)}
              className="font-mono text-xs"
            />
          </div>

          {/* Options row */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                id="skip-tls"
                checked={form.skip_tls_verify}
                onCheckedChange={(v: boolean) => set('skip_tls_verify', v)}
              />
              <Label htmlFor="skip-tls" className="font-normal text-sm">TLS doğrulamasını atla</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="enabled"
                checked={form.enabled}
                onCheckedChange={(v: boolean) => set('enabled', v)}
              />
              <Label htmlFor="enabled" className="font-normal text-sm">Aktif</Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>İptal</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Kaydet' : 'Oluştur'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirmation ───────────────────────────────────────────────────────

function DeleteClusterDialog({
  target,
  onClose,
}: {
  target: K8sCluster | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const del = useDeleteK8sClusterMutation();
  if (!target) return null;
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cluster Sil</AlertDialogTitle>
          <AlertDialogDescription>
            <strong>{target.name}</strong> cluster'ını silmek istediğinize emin misiniz?
            Bu cluster'a bağlı namespace item'ları etkilenebilir.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>İptal</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => {
              del.mutate(target.id, {
                onSuccess: () => { toast({ title: 'Cluster silindi.' }); onClose(); },
                onError: (e) => toast({ title: 'Hata', description: userFriendlyError(e), variant: 'destructive' }),
              });
            }}
          >
            Sil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminK8sClustersPage() {
  useDocumentTitle('K8s Kümeleri');
  const { toast } = useToast();
  const { data: clusters, isLoading } = useAdminK8sClustersQuery();
  const testMutation = useTestK8sClusterMutation();

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<K8sCluster | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<K8sCluster | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleEdit = (c: K8sCluster) => { setEditTarget(c); setFormOpen(true); };
  const handleNew = () => { setEditTarget(null); setFormOpen(true); };
  const handleCloseForm = () => { setFormOpen(false); setEditTarget(null); };

  const handleTest = (c: K8sCluster) => {
    setTestingId(c.id);
    testMutation.mutate(c.id, {
      onSuccess: (data) => {
        const ver = data.version?.gitVersion ?? JSON.stringify(data.version);
        toast({ title: `✅ ${c.name} bağlandı`, description: `Versiyon: ${ver}` });
      },
      onError: (e) => {
        toast({ title: `❌ ${c.name} bağlanamadı`, description: userFriendlyError(e), variant: 'destructive' });
      },
      onSettled: () => setTestingId(null),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" /> K8s Kümeleri
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Kubernetes cluster bağlantı ayarlarını yönetin. Credential'lar master key ile şifreli saklanır.
          </p>
        </div>
        <Button size="sm" onClick={handleNew}>
          <Plus className="mr-2 h-4 w-4" /> Cluster Ekle
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !clusters?.length ? (
        <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
          <Layers className="h-8 w-8" />
          <p>Henüz cluster eklenmemiş.</p>
          <Button variant="outline" size="sm" onClick={handleNew}>
            <Plus className="mr-2 h-4 w-4" /> İlk cluster'ı ekle
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left p-3 font-medium text-muted-foreground">Ad</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Sunucu</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Auth</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Durum</th>
                <th className="text-right p-3 font-medium text-muted-foreground">İşlemler</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clusters.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 text-muted-foreground font-mono text-xs max-w-[200px] truncate">{c.server_url}</td>
                  <td className="p-3"><AuthModeBadge mode={c.auth_mode} /></td>
                  <td className="p-3"><StatusBadge enabled={c.enabled} /></td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleTest(c)}
                        disabled={testingId === c.id}
                        title="Bağlantıyı Test Et"
                      >
                        {testingId === c.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Wifi className="h-4 w-4" />
                        }
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(c)} title="Düzenle">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(c)}
                        title="Sil"
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ClusterFormDialog open={formOpen} editTarget={editTarget} onClose={handleCloseForm} />
      <DeleteClusterDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}
