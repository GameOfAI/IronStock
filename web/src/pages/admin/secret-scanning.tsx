/**
 * AdminSecretScanningPage — Secret leak detection (PR-SCAN).
 *
 * Admins can:
 *   - View recent unacknowledged leak detections
 *   - Acknowledge detections (mark resolved)
 *   - View the scan API endpoint URL + instructions for GitHub Actions / pre-commit hooks
 *   - Create a 'scan'-scoped API token for external tools
 */

import { useState } from 'react';
import {
  AlertTriangle, Check, CheckCircle2, Copy, Loader2, Plus,
  RefreshCw, Shield, Eye, EyeOff, Trash2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { apiFetch } from '@/api/client';
import {
  useAPITokensQuery,
  useCreateAPITokenMutation,
  useDeleteAPITokenMutation,
  type APIToken,
} from '@/api/api-tokens';

// ---------- Types ----------

interface ScanDetection {
  id: string;
  fingerprint_id: string;
  source_type: string;
  source_ref?: string;
  detected_at: string;
  item_id: string;
  item_name: string;
}

// ---------- API hooks ----------

function useScanDetectionsQuery() {
  return useQuery({
    queryKey: ['scan-detections'],
    queryFn: () => apiFetch<{ detections: ScanDetection[] }>('/api/v1/security/scan-detections?limit=100'),
    refetchInterval: 30_000,
  });
}

function useAcknowledgeDetectionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<void>(`/api/v1/security/scan-detections/${id}/acknowledge`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scan-detections'] });
    },
  });
}

// ---------- Component ----------

const scanEndpointURL = `${window.location.origin}/api/v1/security/scan`;

export default function AdminSecretScanningPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const detectionsQuery = useScanDetectionsQuery();
  const ackMutation = useAcknowledgeDetectionMutation();

  const { data: tokenData } = useAPITokensQuery();
  const createToken = useCreateAPITokenMutation();
  const deleteToken = useDeleteAPITokenMutation();

  const scanTokens = (tokenData?.tokens ?? []).filter((t) => t.scope === 'scan');

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<APIToken | null>(null);
  const [ackTarget, setAckTarget] = useState<ScanDetection | null>(null);

  async function copyText(text: string, field: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: 'Kopyalanamadı', variant: 'destructive' });
    }
  }

  async function handleCreateToken() {
    if (!newTokenName.trim()) return;
    try {
      const res = await createToken.mutateAsync({
        name: newTokenName.trim(),
        scope: 'scan',
      });
      setNewTokenValue(res.token ?? null);
      setNewTokenName('');
      toast({ title: 'Tarama token\'u oluşturuldu' });
    } catch {
      toast({ title: 'Token oluşturulamadı', variant: 'destructive' });
    }
  }

  async function handleDeleteToken() {
    if (!deleteTarget) return;
    try {
      await deleteToken.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      toast({ title: 'Token silindi' });
    } catch {
      toast({ title: 'Token silinemedi', variant: 'destructive' });
    }
  }

  async function handleAck() {
    if (!ackTarget) return;
    try {
      await ackMutation.mutateAsync(ackTarget.id);
      setAckTarget(null);
      toast({ title: 'Tespit onaylandı' });
    } catch {
      toast({ title: 'Onaylama başarısız', variant: 'destructive' });
    }
  }

  const detections = detectionsQuery.data?.detections ?? [];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-amber-500" />
        <div>
          <h1 className="text-2xl font-semibold">Gizli Bilgi Sızıntısı Taraması</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Envanterdeki credential'ların git commit'lerde veya dosyalarda tespit edilmesini izler.
          </p>
        </div>
      </div>

      {/* How it works */}
      <section className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
        <p className="font-medium">Nasıl çalışır?</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>
            Item düzenleme ekranından "Sızıntı taramasını etkinleştir" seçeneğini aktif edin.
            Client, ilgili field değerinin SHA-256 hash'ini sunucuya kaydeder.
          </li>
          <li>
            GitHub Actions veya pre-commit hook, repoda bulunan string'lerin
            SHA-256'sını hesaplayıp <code className="bg-muted px-1 rounded">POST /api/v1/security/scan</code> endpoint'ine gönderir.
          </li>
          <li>
            Eşleşme varsa bu sayfada "Tespit" olarak listelenir.
          </li>
        </ol>
      </section>

      {/* Scan endpoint */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Scan Endpoint</h2>
        <div className="flex items-center gap-2">
          <Input readOnly value={scanEndpointURL} className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            onClick={() => copyText(scanEndpointURL, 'endpoint')}
          >
            {copiedField === 'endpoint' ? (
              <Check className="h-4 w-4 text-green-500" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
      </section>

      {/* Scan tokens */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Tarama Token'ları</h2>
          <Button size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="h-4 w-4 mr-1" /> Token Oluştur
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          GitHub Actions ve pre-commit hook'ları bu token'ları kullanarak scan endpoint'ine erişir.
        </p>
        {scanTokens.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-2">
            Henüz scan token'u yok.
          </p>
        ) : (
          <div className="space-y-2">
            {scanTokens.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between rounded-lg border px-4 py-3"
              >
                <div>
                  <p className="font-medium text-sm">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Oluşturuldu: {new Date(t.created_at).toLocaleString('tr-TR')}
                    {t.last_used_at && (
                      <> · Son kullanım: {new Date(t.last_used_at).toLocaleString('tr-TR')}</>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteTarget(t)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Detections */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            Aktif Tespitler
            {detections.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {detections.length}
              </Badge>
            )}
          </h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['scan-detections'] })}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Yenile
          </Button>
        </div>

        {detectionsQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Yükleniyor…</span>
          </div>
        ) : detections.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border px-4 py-6 text-center justify-center text-muted-foreground">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <span>Aktif tespit yok — her şey temiz.</span>
          </div>
        ) : (
          <div className="space-y-2">
            {detections.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-4 py-3 gap-4"
              >
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="font-medium text-sm">{d.item_name}</span>
                    <Badge variant="outline" className="text-xs">
                      {d.source_type}
                    </Badge>
                  </div>
                  {d.source_ref && (
                    <p className="text-xs text-muted-foreground ml-6">
                      Kaynak: <code className="bg-muted px-1 rounded">{d.source_ref}</code>
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground ml-6">
                    Tespit: {new Date(d.detected_at).toLocaleString('tr-TR')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAckTarget(d)}
                >
                  <Check className="h-3.5 w-3.5 mr-1" /> Onayla
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create token modal */}
      <Dialog
        open={showCreateModal}
        onOpenChange={(o) => {
          setShowCreateModal(o);
          if (!o) { setNewTokenValue(null); setShowToken(false); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tarama Token'u Oluştur</DialogTitle>
          </DialogHeader>
          {newTokenValue ? (
            <div className="space-y-3">
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                ⚠ Token yalnızca bir kez gösterilir — kopyalamayı unutmayın.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={showToken ? newTokenValue : '•'.repeat(40)}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowToken((s) => !s)}
                >
                  {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyText(newTokenValue, 'newtoken')}
                >
                  {copiedField === 'newtoken' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => { setShowCreateModal(false); setNewTokenValue(null); }}>
                  Kapat
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="token-name">Token adı</Label>
                <Input
                  id="token-name"
                  placeholder="github-actions-prod"
                  value={newTokenName}
                  onChange={(e) => setNewTokenName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateToken()}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowCreateModal(false)}
                >
                  İptal
                </Button>
                <Button
                  onClick={handleCreateToken}
                  disabled={!newTokenName.trim() || createToken.isPending}
                >
                  {createToken.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                  Oluştur
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete token confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Token'u Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> token'u silinecek.
              Bu token'u kullanan entegrasyonlar artık erişemeyecek.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteToken}>Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Acknowledge confirm */}
      <AlertDialog open={!!ackTarget} onOpenChange={(o) => !o && setAckTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tespiti Onayla</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{ackTarget?.item_name}</strong> için bu sızıntı tespiti onaylandı olarak
              işaretlenecek. Credential'ı döndürdüğünüzden emin olun.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleAck}>Onayla</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
