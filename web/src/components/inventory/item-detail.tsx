/**
 * ItemDetail — sağ panel, seçili item'ın 5 sekmelik görünümü (PR-UX7).
 *
 * Sekmeler:
 *  - Genel      → metadata, açıklama, etiketler, expiry/rotasyon
 *  - Alanlar    → şifreli field değerleri (mask / göster / kopyala)
 *  - İlişkiler  → giden + gelen ilişkiler, ekleme formu
 *  - Yaşam Döng.→ lifecycle stage toggle (8 aşama)
 *  - Geçmiş     → field version timeline
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Clock,
  DatabaseZap,
  Eye,
  EyeOff,
  Info,
  Loader2,
  MousePointerClick,
  Package,
  Plus,
  RefreshCw,
  Star,
  StarOff,
  X,
  Lock,
  History,
  ShieldAlert,
  SendHorizonal,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import type { ExternalSourceVault, FieldDefinition, ItemType, RelationshipType, VaultFieldValue } from '@/api/types';
import { useVaultFetchMutation, useIssueDynamicCredMutation, useRevokeDynamicCredMutation } from '@/api/vault';
import type { DynamicCred } from '@/api/vault';
import { useCreateAccessRequestMutation, useCancelAccessRequestMutation } from '@/api/access-requests';
import { useItem, useRecordRotationMutation, useFieldVersionsQuery } from '@/api/items';
import {
  useAddFavoriteMutation,
  useRemoveFavoriteMutation,
  useFavoriteStatusQuery,
} from '@/api/tags';
import { useGraphQuery, useAddRelationshipMutation, useDeleteRelationshipMutation } from '@/api/graph';
import { useLifecycleStagesQuery, useItemLifecycleStagesQuery, useSetItemLifecycleStagesMutation } from '@/api/lifecycle';
import { useAuthStore } from '@/store/auth';
import { fromBase64, openDEKWithKEK, decryptField } from '@/lib/crypto';
import { ItemTagPicker } from './item-tag-picker';
import { PermissionBadge } from './permission-badge';
import { ItemFieldRow } from './item-field-row';
import { ItemAttachmentPanel } from './item-attachment-panel';
import { ShareLinkDialog } from './share-link-dialog';
import { LinkedItemsTab } from './linked-items-tab'; // PR-LINK
import { RelativeTime } from '@/components/common/relative-time';
import { cn } from '@/lib/cn';
import {
  PIPELINE_TYPE_ICONS,
  PIPELINE_TYPE_LABELS,
  REL_LABELS,
} from '@/components/pipeline/pipeline-constants';

// --- Types ---

interface ItemDetailProps {
  itemId: string | null;
  fieldDefinitions: FieldDefinition[];
  itemTypes: ItemType[];
}

type DecryptionState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; values: Map<number, string> }
  | { status: 'error'; message: string };

// --- Relationship type constants ---

const REL_TYPES: RelationshipType[] = [
  'hosted_on', 'accessed_via', 'part_of', 'related_to', 'depends_on',
  'uses_tool', 'builds_to', 'scans_with', 'deploys_to',
];

// --- Lifecycle stage display config ---

const STAGE_COLORS: Record<string, string> = {
  plan: 'bg-purple-500/20 text-purple-400 border-purple-500/30 data-[active=true]:bg-purple-500 data-[active=true]:text-white data-[active=true]:border-purple-500',
  code: 'bg-blue-500/20 text-blue-400 border-blue-500/30 data-[active=true]:bg-blue-500 data-[active=true]:text-white data-[active=true]:border-blue-500',
  build: 'bg-orange-500/20 text-orange-400 border-orange-500/30 data-[active=true]:bg-orange-500 data-[active=true]:text-white data-[active=true]:border-orange-500',
  test: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 data-[active=true]:bg-yellow-500 data-[active=true]:text-white data-[active=true]:border-yellow-500',
  release: 'bg-green-500/20 text-green-400 border-green-500/30 data-[active=true]:bg-green-500 data-[active=true]:text-white data-[active=true]:border-green-500',
  deploy: 'bg-teal-500/20 text-teal-400 border-teal-500/30 data-[active=true]:bg-teal-500 data-[active=true]:text-white data-[active=true]:border-teal-500',
  operate: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 data-[active=true]:bg-indigo-500 data-[active=true]:text-white data-[active=true]:border-indigo-500',
  monitor: 'bg-pink-500/20 text-pink-400 border-pink-500/30 data-[active=true]:bg-pink-500 data-[active=true]:text-white data-[active=true]:border-pink-500',
};

// --- Helper ---

function buildFieldDefMap(defs: FieldDefinition[]): Map<number, FieldDefinition> {
  const map = new Map<number, FieldDefinition>();
  for (const d of defs) map.set(d.id, d);
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

// Parse external_source and return ExternalSourceVault when type=vault.
function parseVaultSource(raw: Record<string, unknown> | null | undefined): ExternalSourceVault | null {
  if (!raw || raw['type'] !== 'vault') return null;
  return raw as unknown as ExternalSourceVault;
}

export function ItemDetail({ itemId, fieldDefinitions, itemTypes: _itemTypes }: ItemDetailProps) {
  const itemQuery = useItem(itemId);
  const privateKey = useAuthStore((s) => s.privateKey);
  const [decryption, setDecryption] = useState<DecryptionState>({ status: 'idle' });
  const { toast } = useToast();
  const rotateMut = useRecordRotationMutation(itemId ?? '');

  // PR-VAULT: ephemeral vault values — never cached, auto-cleared after 30 s.
  const vaultMut = useVaultFetchMutation(itemId ?? '');
  const [vaultFields, setVaultFields] = useState<VaultFieldValue[] | null>(null);
  const [vaultVisible, setVaultVisible] = useState(false);
  const vaultClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PR-VAULT-DYN: ephemeral dynamic credentials — plaintext, never cached.
  const dynCredMut = useIssueDynamicCredMutation(itemId ?? '');
  const revokeCredMut = useRevokeDynamicCredMutation(itemId ?? '');
  const [dynCred, setDynCred] = useState<DynamicCred | null>(null);
  const [dynCredVisible, setDynCredVisible] = useState(false);
  const [dynCountdown, setDynCountdown] = useState(0);
  const dynClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dynTickTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clear vault values whenever the selected item changes.
  useEffect(() => {
    setVaultFields(null);
    setVaultVisible(false);
    if (vaultClearTimer.current) clearTimeout(vaultClearTimer.current);
  }, [itemId]);

  // Clear dynamic credential whenever the selected item changes.
  useEffect(() => {
    setDynCred(null);
    setDynCredVisible(false);
    setDynCountdown(0);
    if (dynClearTimer.current) clearTimeout(dynClearTimer.current);
    if (dynTickTimer.current) clearInterval(dynTickTimer.current);
  }, [itemId]);

  function handleVaultFetch() {
    vaultMut.mutate(undefined, {
      onSuccess: (data) => {
        setVaultFields(data.fields);
        setVaultVisible(true);
        if (vaultClearTimer.current) clearTimeout(vaultClearTimer.current);
        vaultClearTimer.current = setTimeout(() => {
          setVaultFields(null);
          setVaultVisible(false);
          toast({ title: 'Vault değerleri temizlendi', description: '30 saniyelik güvenli görüntüleme süresi doldu.' });
        }, 30_000);
      },
      onError: (err) => {
        toast({
          title: 'Vault fetch başarısız',
          description: err instanceof Error ? err.message : 'Sunucu hatası.',
          variant: 'destructive',
        });
      },
    });
  }

  function handleIssueDynamic() {
    // Clear any existing cred first.
    if (dynClearTimer.current) clearTimeout(dynClearTimer.current);
    if (dynTickTimer.current) clearInterval(dynTickTimer.current);
    setDynCred(null);

    dynCredMut.mutate(undefined, {
      onSuccess: (cred) => {
        setDynCred(cred);
        setDynCredVisible(false);
        const secs = cred.lease_duration > 0 ? cred.lease_duration : 30;
        setDynCountdown(secs);

        // Countdown tick.
        dynTickTimer.current = setInterval(() => {
          setDynCountdown((n) => {
            if (n <= 1) {
              if (dynTickTimer.current) clearInterval(dynTickTimer.current);
              return 0;
            }
            return n - 1;
          });
        }, 1_000);

        // Auto-clear when lease expires.
        dynClearTimer.current = setTimeout(() => {
          setDynCred(null);
          setDynCredVisible(false);
          setDynCountdown(0);
          toast({ title: 'Dinamik credential süresi doldu', description: 'Kimlik bilgileri hafızadan silindi.' });
        }, secs * 1_000);
      },
      onError: (err) => {
        toast({
          title: 'Dinamik credential alınamadı',
          description: err instanceof Error ? err.message : 'Vault hatası.',
          variant: 'destructive',
        });
      },
    });
  }

  function handleRevokeDynamic() {
    if (!dynCred) return;
    const leaseId = dynCred.lease_id;
    // Clear UI immediately (best-effort revocation).
    setDynCred(null);
    setDynCredVisible(false);
    setDynCountdown(0);
    if (dynClearTimer.current) clearTimeout(dynClearTimer.current);
    if (dynTickTimer.current) clearInterval(dynTickTimer.current);
    revokeCredMut.mutate(leaseId, {
      onError: () => {
        // Revocation is best-effort; inform but don't block.
        toast({ title: 'Lease iptal edilemedi', description: 'Lease zaten süresi dolmuş olabilir.', variant: 'destructive' });
      },
    });
  }

  // Favorites
  const { data: favData } = useFavoriteStatusQuery(itemId);
  const isFavorited = favData === true;
  const addFav = useAddFavoriteMutation(itemId ?? '');
  const removeFav = useRemoveFavoriteMutation(itemId ?? '');

  const item = itemQuery.data;

  // Decrypt field values when item + privateKey ready
  useEffect(() => {
    if (!item || !privateKey) {
      setDecryption({ status: 'idle' });
      return;
    }
    if (!item.owner_dek_wrapped || !item.owner_wrap_nonce) {
      setDecryption({ status: 'error', message: 'Owner DEK eksik (sunucu döndürmedi).' });
      return;
    }

    let cancelled = false;
    setDecryption({ status: 'pending' });

    (async () => {
      try {
        const wrapped = fromBase64(item.owner_dek_wrapped!);
        const wrapNonce = fromBase64(item.owner_wrap_nonce!);
        const dek = await openDEKWithKEK(wrapped, wrapNonce, privateKey);
        const out = new Map<number, string>();
        for (const f of item.fields ?? []) {
          if (!f.value_enc || !f.value_nonce) continue;
          try {
            const plain = await decryptField(fromBase64(f.value_enc), fromBase64(f.value_nonce), dek);
            out.set(f.field_definition_id, plain);
          } catch { /* skip un-decryptable field */ }
        }
        if (!cancelled) setDecryption({ status: 'success', values: out });
      } catch (err) {
        if (!cancelled) {
          setDecryption({
            status: 'error',
            message: err instanceof Error ? err.message : 'Şifre çözme başarısız.',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [item, privateKey]);

  const fieldDefMap = useMemo(() => buildFieldDefMap(fieldDefinitions), [fieldDefinitions]);

  // ── Empty state ──────────────────────────────────────────────────────────
  if (!itemId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <MousePointerClick className="h-8 w-8" aria-hidden />
        <p className="text-sm">Detayları görmek için listeden bir item seçin.</p>
      </div>
    );
  }

  if (itemQuery.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (itemQuery.isError || !item) {
    return (
      <div className="p-4 text-sm text-destructive">
        Item okunamadı.{' '}
        <button type="button" onClick={() => itemQuery.refetch()} className="underline">
          Tekrar dene
        </button>
      </div>
    );
  }

  const fields = (item.fields ?? []).slice().sort((a, b) => a.position - b.position);
  const decryptedValues = decryption.status === 'success' ? decryption.values : null;
  const TypeIcon = PIPELINE_TYPE_ICONS[item.item_type_id] ?? Package;
  const typeLabel = PIPELINE_TYPE_LABELS[item.item_type_id] ?? `tip:${item.item_type_id}`;

  // Expiry helpers
  const expDate = item.expires_at ? new Date(item.expires_at) : null;
  const isExpired = expDate ? expDate.getTime() <= Date.now() : false;
  const isWarning = expDate ? expDate.getTime() <= Date.now() + 7 * 24 * 60 * 60 * 1000 : false;

  return (
    <div className="flex h-full flex-col">
      {/* ── Sabit Header ────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b px-4 pt-4 pb-0">
        <div className="flex items-start gap-3 mb-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
            <TypeIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-semibold leading-tight truncate flex-1">{item.name}</h2>
              {item.permission === 'write' && <ShareLinkDialog item={item} />}
              <button
                type="button"
                aria-label={isFavorited ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
                disabled={addFav.isPending || removeFav.isPending}
                onClick={async () => {
                  try {
                    if (isFavorited) await removeFav.mutateAsync();
                    else await addFav.mutateAsync();
                  } catch {
                    toast({ title: 'Favori durumu güncellenemedi', variant: 'destructive' });
                  }
                }}
              >
                {isFavorited
                  ? <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  : <StarOff className="h-4 w-4" />
                }
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
              <Badge variant="secondary" className="text-xs px-1.5 py-0 h-5">
                {typeLabel}
              </Badge>
              <PermissionBadge permission={item.permission} />
              {isExpired && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0 h-5 gap-1">
                  <AlertTriangle className="h-3 w-3" /> Süresi doldu
                </Badge>
              )}
              {isWarning && !isExpired && (
                <span className="inline-flex items-center gap-0.5 text-xs text-amber-500">
                  <Clock className="h-3 w-3" />
                  {expDate?.toLocaleDateString('tr-TR')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <Tabs defaultValue="genel" className="w-full">
          <TabsList className="w-full gap-0">
            <TabsTrigger value="genel">Genel</TabsTrigger>
            <TabsTrigger value="alanlar">Alanlar {fields.length > 0 && <span className="ml-1 text-muted-foreground">({fields.length})</span>}</TabsTrigger>
            <TabsTrigger value="iliskiler">İlişkiler</TabsTrigger>
            <TabsTrigger value="baglanti">Bağlantılar</TabsTrigger>
            <TabsTrigger value="yasam">Yaşam Döngüsü</TabsTrigger>
            <TabsTrigger value="gecmis">Geçmiş</TabsTrigger>
          </TabsList>

          {/* ── GENEL ────────────────────────────────────────────────────────── */}
          <TabsContent value="genel" className="px-0" forceMount>
            <div className="space-y-4 p-4">
              {/* Açıklama */}
              {item.description ? (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Açıklama</h3>
                  <p className="whitespace-pre-wrap rounded-md border bg-muted/30 px-3 py-2 text-sm">
                    {item.description}
                  </p>
                </section>
              ) : (
                <p className="text-xs italic text-muted-foreground">Açıklama eklenmemiş.</p>
              )}

              {/* Etiketler */}
              {itemId && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Etiketler</h3>
                  <ItemTagPicker itemId={itemId} />
                </section>
              )}

              {/* Süre & Rotasyon */}
              {(item.expires_at || item.rotation_interval_days || item.last_rotated_at) && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Süre &amp; Rotasyon</h3>
                  <div className={cn(
                    'rounded-md border px-3 py-2.5 space-y-1.5 text-xs',
                    isExpired && 'border-destructive/40 bg-destructive/5',
                    isWarning && !isExpired && 'border-amber-500/40 bg-amber-500/5',
                  )}>
                    {item.expires_at && (
                      <div className="flex items-center gap-1.5">
                        {isExpired
                          ? <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                          : isWarning
                            ? <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                            : <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        }
                        <span className={cn(
                          isExpired && 'text-destructive font-medium',
                          isWarning && !isExpired && 'text-amber-600 dark:text-amber-400',
                        )}>
                          Son geçerlilik: {expDate?.toLocaleDateString('tr-TR')}
                          {isExpired && ' (Süresi doldu)'}
                          {isWarning && !isExpired && ' (Yaklaşıyor)'}
                        </span>
                      </div>
                    )}
                    {item.rotation_interval_days && (
                      <div className="text-muted-foreground">
                        Rotasyon politikası: her {item.rotation_interval_days} günde bir
                      </div>
                    )}
                    {item.last_rotated_at && (
                      <div className="text-muted-foreground">
                        Son rotasyon: <RelativeTime iso={item.last_rotated_at} />
                      </div>
                    )}
                  </div>
                  {item.permission === 'write' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 gap-1.5 h-7 text-xs"
                      disabled={rotateMut.isPending}
                      onClick={async () => {
                        try {
                          await rotateMut.mutateAsync();
                          toast({ title: 'Rotasyon kaydedildi' });
                        } catch {
                          toast({ title: 'Rotasyon kaydedilemedi', variant: 'destructive' });
                        }
                      }}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Rotasyonu Kaydet
                    </Button>
                  )}
                </section>
              )}

              {/* PR-VAULT: Vault-backed secret reveal panel */}
              {(() => {
                const vaultSrc = parseVaultSource(item.external_source as Record<string, unknown> | null);
                if (!vaultSrc) return null;
                return (
                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vault Kaynağı</h3>
                    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <DatabaseZap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {vaultSrc.mount}/{vaultSrc.path}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2">
                          {vaultFields && (
                            <button
                              type="button"
                              aria-label={vaultVisible ? 'Gizle' : 'Göster'}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              onClick={() => setVaultVisible((v) => !v)}
                            >
                              {vaultVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 h-7 text-xs"
                            disabled={vaultMut.isPending}
                            onClick={handleVaultFetch}
                          >
                            {vaultMut.isPending
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <DatabaseZap className="h-3 w-3" />
                            }
                            {vaultFields ? 'Yenile' : "Vault'tan Çek"}
                          </Button>
                        </div>
                      </div>

                      {vaultFields && vaultVisible && (
                        <div className="rounded-md border bg-background divide-y">
                          {vaultFields.map((f) => {
                            const label = Object.entries(vaultSrc.key_mapping ?? {}).find(([, v]) => v === f.field_key)?.[0] ?? f.field_key;
                            return (
                              <div key={f.field_key} className="flex items-center justify-between px-3 py-2 text-xs gap-3">
                                <span className="text-muted-foreground font-medium shrink-0">{label}</span>
                                <span className="font-mono break-all select-all">{f.value}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {vaultFields && !vaultVisible && (
                        <p className="text-xs text-muted-foreground italic">Değerler gizlendi.</p>
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        Vault değerleri 30 saniye sonra otomatik temizlenir.
                      </p>
                    </div>

                    {/* PR-VAULT-DYN: Dynamic credential panel */}
                    {vaultSrc.dynamic && (
                      <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <DatabaseZap className="h-4 w-4 text-violet-500 dark:text-violet-400" aria-hidden />
                            <span className="text-xs font-medium">Dinamik Credential</span>
                            {dynCountdown > 0 && (
                              <Badge variant="outline" className="font-mono text-[10px] tabular-nums text-amber-600 border-amber-500/40">
                                {dynCountdown}s
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {dynCred && (
                              <>
                                <button
                                  type="button"
                                  aria-label={dynCredVisible ? 'Gizle' : 'Göster'}
                                  className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                                  onClick={() => setDynCredVisible((v) => !v)}
                                >
                                  {dynCredVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                </button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="gap-1.5 h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                                  onClick={handleRevokeDynamic}
                                  disabled={revokeCredMut.isPending}
                                >
                                  <X className="h-3 w-3" />
                                  İptal Et
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 h-7 text-xs"
                              disabled={dynCredMut.isPending}
                              onClick={handleIssueDynamic}
                            >
                              {dynCredMut.isPending
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : <DatabaseZap className="h-3 w-3" />
                              }
                              {dynCred ? 'Yenile' : 'Credential Al'}
                            </Button>
                          </div>
                        </div>

                        {dynCred && dynCredVisible && (
                          <div className="rounded-md border bg-background divide-y">
                            <div className="flex items-center justify-between px-3 py-2 text-xs gap-3">
                              <span className="text-muted-foreground font-medium shrink-0">Kullanıcı Adı</span>
                              <span className="font-mono break-all select-all">{dynCred.username}</span>
                            </div>
                            <div className="flex items-center justify-between px-3 py-2 text-xs gap-3">
                              <span className="text-muted-foreground font-medium shrink-0">Parola</span>
                              <span className="font-mono break-all select-all">{dynCred.password}</span>
                            </div>
                            <div className="flex items-center justify-between px-3 py-2 text-xs gap-3">
                              <span className="text-muted-foreground font-medium shrink-0">Lease ID</span>
                              <span className="font-mono break-all text-muted-foreground truncate max-w-[180px]">{dynCred.lease_id}</span>
                            </div>
                          </div>
                        )}

                        {dynCred && !dynCredVisible && (
                          <p className="text-xs text-muted-foreground italic">Credential gizlendi. Göster butonuna basın.</p>
                        )}

                        {!dynCred && (
                          <p className="text-[10px] text-muted-foreground">
                            Vault'tan geçici kullanıcı adı + parola üretir. Lease süresi dolunca otomatik silinir.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                );
              })()}

              {/* PR-N3: Approval gate panel — shown when item requires approval and
                  caller has no active approved access */}
              {item.requires_approval && (item.fields == null || item.fields.length === 0) && (
                <ApprovalPanel itemId={itemId} item={item} />
              )}

              {/* Metadata */}
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bilgi</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Oluşturulma</dt>
                    <dd><RelativeTime iso={item.created_at} /></dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Güncellenme</dt>
                    <dd><RelativeTime iso={item.updated_at} /></dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Oluşturan</dt>
                    <dd className="font-mono truncate">{item.created_by}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">İzin</dt>
                    <dd><PermissionBadge permission={item.permission} /></dd>
                  </div>
                </dl>
              </section>

              {/* Attachments */}
              <ItemAttachmentPanel itemId={item.id} canWrite={item.permission === 'write'} />
            </div>
          </TabsContent>

          {/* ── ALANLAR ──────────────────────────────────────────────────────── */}
          <TabsContent value="alanlar" className="px-0" forceMount>
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3 w-3" />
                Alanlar uçtan uca şifrelenir
                {decryption.status === 'pending' && (
                  <span className="flex items-center gap-1 ml-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Çözülüyor…
                  </span>
                )}
              </div>

              {fields.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                  <Package className="h-8 w-8 opacity-30" />
                  <p className="text-sm">Bu item'da alan tanımlı değil.</p>
                </div>
              ) : (
                <div className="rounded-md border">
                  <div className="px-3">
                    {fields.map((f, idx) => (
                      <ItemFieldRow
                        key={`${f.field_definition_id}-${idx}`}
                        field={f}
                        definition={fieldDefMap.get(f.field_definition_id)}
                        decryptedValue={decryptedValues?.get(f.field_definition_id) ?? null}
                        decryptionStatus={decryption.status}
                        itemId={item.id}
                      />
                    ))}
                  </div>
                </div>
              )}

              {decryption.status === 'error' && (
                <p className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Alanlar şu oturumda çözülemiyor: {decryption.message}</span>
                </p>
              )}
            </div>
          </TabsContent>

          {/* ── İLİŞKİLER ────────────────────────────────────────────────────── */}
          <TabsContent value="iliskiler" className="px-0" forceMount>
            <RelationshipsTab itemId={item.id} canWrite={item.permission === 'write'} />
          </TabsContent>

          {/* ── BAĞLANTILI ITEM'LAR (PR-LINK) ───────────────────────────────── */}
          <TabsContent value="baglanti" className="px-0" forceMount>
            <LinkedItemsTab
              itemId={item.id}
              fieldDefs={fieldDefinitions.map((fd) => ({ id: String(fd.id), label: fd.label }))}
              canWrite={item.permission === 'write'}
            />
          </TabsContent>

          {/* ── YAŞAM DÖNGÜSÜ ────────────────────────────────────────────────── */}
          <TabsContent value="yasam" className="px-0" forceMount>
            <LifecycleTab itemId={item.id} canWrite={item.permission === 'write'} />
          </TabsContent>

          {/* ── GEÇMİŞ ──────────────────────────────────────────────────────── */}
          <TabsContent value="gecmis" className="px-0" forceMount>
            <HistoryTab itemId={item.id} fields={fields} fieldDefMap={fieldDefMap} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// İlişkiler Tab
// ─────────────────────────────────────────────────────────────────────────────

function RelationshipsTab({ itemId, canWrite }: { itemId: string; canWrite: boolean }) {
  const graphQuery = useGraphQuery();
  const addMut = useAddRelationshipMutation(itemId);
  const deleteMut = useDeleteRelationshipMutation(itemId);
  const [showAdd, setShowAdd] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [relType, setRelType] = useState<RelationshipType>('depends_on');
  const { toast } = useToast();

  if (graphQuery.isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const nodes = graphQuery.data?.nodes ?? [];
  const edges = graphQuery.data?.edges ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const outgoing = edges.filter((e) => e.source_id === itemId);
  const incoming = edges.filter((e) => e.target_id === itemId);

  const otherNodes = nodes.filter((n) => n.id !== itemId);

  async function handleAdd() {
    if (!targetId) return;
    try {
      await addMut.mutateAsync({ target_id: targetId, type: relType });
      setShowAdd(false);
      setTargetId('');
      toast({ title: 'İlişki eklendi' });
    } catch {
      toast({ title: 'İlişki eklenemedi', variant: 'destructive' });
    }
  }

  async function handleDelete(targetId: string, type: RelationshipType) {
    try {
      await deleteMut.mutateAsync({ targetId, type });
      toast({ title: 'İlişki kaldırıldı' });
    } catch {
      toast({ title: 'İlişki kaldırılamadı', variant: 'destructive' });
    }
  }

  return (
    <div className="p-4 space-y-4">
      {/* Giden ilişkiler */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Giden İlişkiler ({outgoing.length})
          </h3>
        </div>
        {outgoing.length === 0 ? (
          <p className="text-xs italic text-muted-foreground pl-5">Giden ilişki yok.</p>
        ) : (
          <div className="space-y-1.5">
            {outgoing.map((e) => {
              const target = nodeMap.get(e.target_id);
              const TargetIcon = PIPELINE_TYPE_ICONS[target?.item_type_id ?? 0] ?? Package;
              return (
                <div key={`${e.target_id}-${e.type}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                  <span className="text-primary font-medium">{REL_LABELS[e.type]}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <TargetIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate flex-1">{target?.name ?? e.target_id}</span>
                  {canWrite && (
                    <button
                      type="button"
                      onClick={() => handleDelete(e.target_id, e.type)}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-auto shrink-0"
                      title="İlişkiyi kaldır"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Gelen ilişkiler */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <ArrowLeft className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Gelen İlişkiler ({incoming.length})
          </h3>
        </div>
        {incoming.length === 0 ? (
          <p className="text-xs italic text-muted-foreground pl-5">Gelen ilişki yok.</p>
        ) : (
          <div className="space-y-1.5">
            {incoming.map((e) => {
              const source = nodeMap.get(e.source_id);
              const SrcIcon = PIPELINE_TYPE_ICONS[source?.item_type_id ?? 0] ?? Package;
              return (
                <div key={`${e.source_id}-${e.type}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
                  <SrcIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium truncate">{source?.name ?? e.source_id}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-primary font-medium flex-1">{REL_LABELS[e.type]}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* İlişki ekleme */}
      {canWrite && (
        <section>
          {!showAdd ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs w-full"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              İlişki Ekle
            </Button>
          ) : (
            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-medium">Yeni İlişki</p>
              <Select value={relType} onValueChange={(v) => setRelType(v as RelationshipType)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REL_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">{REL_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Hedef item seç" />
                </SelectTrigger>
                <SelectContent>
                  {otherNodes.map((n) => (
                    <SelectItem key={n.id} value={n.id} className="text-xs">{n.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAdd} disabled={!targetId || addMut.isPending}>
                  {addMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ekle'}
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setShowAdd(false); setTargetId(''); }}>
                  İptal
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yaşam Döngüsü Tab
// ─────────────────────────────────────────────────────────────────────────────

function LifecycleTab({ itemId, canWrite }: { itemId: string; canWrite: boolean }) {
  const stagesQuery = useLifecycleStagesQuery();
  const itemStagesQuery = useItemLifecycleStagesQuery(itemId);
  const setMut = useSetItemLifecycleStagesMutation(itemId);
  const { toast } = useToast();

  const stages = stagesQuery.data?.stages ?? [];
  const assignedIds = new Set(itemStagesQuery.data?.stage_ids ?? []);

  async function toggleStage(stageId: number) {
    if (!canWrite) return;
    const next = new Set(assignedIds);
    if (next.has(stageId)) next.delete(stageId);
    else next.add(stageId);
    try {
      await setMut.mutateAsync({ stage_ids: Array.from(next) });
    } catch {
      toast({ title: 'Yaşam döngüsü güncellenemedi', variant: 'destructive' });
    }
  }

  if (stagesQuery.isLoading || itemStagesQuery.isLoading) {
    return (
      <div className="p-4 space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const assignedCount = assignedIds.size;
  const totalCount = stages.length;
  const coveragePct = totalCount > 0 ? Math.round((assignedCount / totalCount) * 100) : 0;

  return (
    <div className="p-4 space-y-4">
      {canWrite && (
        <p className="text-xs text-muted-foreground">
          Aşamalara tıklayarak bu item'ın yaşam döngüsündeki konumunu işaretleyin.
        </p>
      )}

      {/* Stage pills */}
      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => {
          const isActive = assignedIds.has(stage.id);
          const colorClass = STAGE_COLORS[stage.key] ?? '';
          return (
            <button
              key={stage.id}
              type="button"
              data-active={isActive}
              disabled={!canWrite || setMut.isPending}
              onClick={() => toggleStage(stage.id)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                colorClass,
                canWrite ? 'cursor-pointer hover:opacity-80' : 'cursor-default',
              )}
            >
              {isActive && <span>✓</span>}
              {stage.label}
            </button>
          );
        })}
      </div>

      {/* Flow diagram — mini linear */}
      <div className="flex items-center gap-0.5 overflow-x-auto py-2">
        {stages.map((stage, i) => {
          const isActive = assignedIds.has(stage.id);
          return (
            <div key={stage.id} className="flex items-center">
              <div className={cn(
                'rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
                isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
                {stage.label.toUpperCase().slice(0, 3)}
              </div>
              {i < stages.length - 1 && (
                <div className={cn('h-px w-4 shrink-0', isActive ? 'bg-primary' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-3 text-center">
        <div>
          <p className="text-lg font-semibold">{assignedCount}</p>
          <p className="text-xs text-muted-foreground">atanmış aşama</p>
        </div>
        <div>
          <p className="text-lg font-semibold">{totalCount - assignedCount}</p>
          <p className="text-xs text-muted-foreground">eksik aşama</p>
        </div>
        <div>
          <p className={cn('text-lg font-semibold', coveragePct >= 50 ? 'text-green-500' : 'text-amber-500')}>
            {coveragePct}%
          </p>
          <p className="text-xs text-muted-foreground">kapsam</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Geçmiş Tab
// ─────────────────────────────────────────────────────────────────────────────

type SortedField = { field_definition_id: number; position: number };

function HistoryTab({
  itemId,
  fields,
  fieldDefMap,
}: {
  itemId: string;
  fields: SortedField[];
  fieldDefMap: Map<number, FieldDefinition>;
}) {
  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
        <History className="h-8 w-8 opacity-30" />
        <p className="text-sm">Alan geçmişi yok.</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-1.5 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3 shrink-0" />
        Değerler şifreli — yalnızca alan adı ve değişim tarihi görünür.
      </div>
      {fields.map((f) => (
        <FieldHistorySection
          key={f.field_definition_id}
          itemId={itemId}
          fieldDefId={f.field_definition_id}
          fieldLabel={fieldDefMap.get(f.field_definition_id)?.label ?? `Alan #${f.field_definition_id}`}
        />
      ))}
    </div>
  );
}

function FieldHistorySection({
  itemId,
  fieldDefId,
  fieldLabel,
}: {
  itemId: string;
  fieldDefId: number;
  fieldLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const versionsQuery = useFieldVersionsQuery(open ? itemId : null, open ? fieldDefId : null);

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium">{fieldLabel}</span>
        <span className="text-muted-foreground">
          {open ? '▲' : '▼'}
          {versions.length > 0 && ` ${versions.length} versiyon`}
        </span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2">
          {versionsQuery.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : versions.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">Versiyon kaydı yok.</p>
          ) : (
            versions.map((v) => (
              <div key={v.version_number} className="flex items-center gap-2 text-xs">
                <span className="w-6 shrink-0 text-center rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">
                  v{v.version_number}
                </span>
                <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground flex-1">şifreli</span>
                <RelativeTime iso={v.changed_at} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---- PR-N3: Approval gate panel ----

function ApprovalPanel({ itemId, item }: { itemId: string; item: { my_access_request?: { id: string; status: string; deny_reason?: string | null; expires_at?: string | null } | null } }) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState(60);
  const [showForm, setShowForm] = useState(false);
  const { toast } = useToast();

  const createMut = useCreateAccessRequestMutation(itemId);
  const cancelMut = useCancelAccessRequestMutation(itemId);

  const existing = item.my_access_request;

  async function handleRequest() {
    try {
      await createMut.mutateAsync({ reason, access_duration_minutes: duration });
      setShowForm(false);
      toast({ title: 'Erişim isteği gönderildi', description: 'Admin onayladığında bildirim alacaksınız.' });
    } catch {
      toast({ title: 'İstek gönderilemedi', variant: 'destructive' });
    }
  }

  async function handleCancel() {
    if (!existing) return;
    try {
      await cancelMut.mutateAsync(existing.id);
      toast({ title: 'İstek iptal edildi' });
    } catch {
      toast({ title: 'İptal başarısız', variant: 'destructive' });
    }
  }

  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Erişim Onayı
      </h3>
      <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 p-3 space-y-3">
        <div className="flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-700 dark:text-amber-400">
            <p className="font-medium">Bu item onay gerektiriyor.</p>
            <p className="mt-0.5 text-amber-600 dark:text-amber-500">
              Şifreli alanları görüntülemek için admin onayı almanız gerekiyor.
            </p>
          </div>
        </div>

        {/* Existing request status */}
        {existing && existing.status === 'pending' && (
          <div className="flex items-center justify-between rounded bg-white/50 dark:bg-black/20 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              <span>İsteğiniz admin onayı bekliyor.</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground"
              disabled={cancelMut.isPending}
              onClick={handleCancel}
            >
              İptal et
            </Button>
          </div>
        )}

        {existing && existing.status === 'denied' && (
          <div className="rounded bg-red-50 dark:bg-red-950/20 border border-red-200 px-3 py-2 text-xs text-red-600">
            İsteğiniz reddedildi.{existing.deny_reason && ` Neden: ${existing.deny_reason}`}
          </div>
        )}

        {/* Request form */}
        {(!existing || existing.status === 'denied' || existing.status === 'cancelled' || existing.status === 'expired') && (
          showForm ? (
            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="text-xs font-medium">Neden erişime ihtiyacınız var? (opsiyonel)</label>
                <textarea
                  className="w-full rounded border bg-white/70 dark:bg-black/20 px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
                  rows={2}
                  placeholder="Erişim gerekçenizi belirtin…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium shrink-0">Süre (dk):</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-20 rounded border bg-white/70 dark:bg-black/20 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
                <span className="text-[10px] text-muted-foreground">(max 1440 = 24 saat)</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={createMut.isPending}
                  onClick={handleRequest}
                >
                  {createMut.isPending
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <SendHorizonal className="h-3 w-3" />}
                  Gönder
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setShowForm(false)}
                >
                  İptal
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
              onClick={() => setShowForm(true)}
            >
              <SendHorizonal className="h-3 w-3" />
              Erişim İste
            </Button>
          )
        )}
      </div>
    </section>
  );
}
