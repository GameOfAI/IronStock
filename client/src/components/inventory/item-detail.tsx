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

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Clock,
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
import type { FieldDefinition, ItemType, RelationshipType } from '@/api/types';
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ItemDetail({ itemId, fieldDefinitions, itemTypes: _itemTypes }: ItemDetailProps) {
  const itemQuery = useItem(itemId);
  const privateKey = useAuthStore((s) => s.privateKey);
  const [decryption, setDecryption] = useState<DecryptionState>({ status: 'idle' });
  const { toast } = useToast();
  const rotateMut = useRecordRotationMutation(itemId ?? '');

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
              {item.kind && (
                <span className="shrink-0 rounded border border-slate-700 bg-slate-800/60 px-1 font-mono text-[9px] uppercase tracking-wide text-slate-400">
                  {item.kind}
                </span>
              )}
              <h2 className="text-base font-semibold leading-tight truncate flex-1">{item.name}</h2>
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
            <TabsTrigger value="alanlar">
              Alanlar {fields.length > 0 && <span className="ml-1 text-muted-foreground">({fields.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="iliskiler">İlişkiler</TabsTrigger>
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

  async function handleDelete(tId: string, type: RelationshipType) {
    try {
      await deleteMut.mutateAsync({ targetId: tId, type });
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
                <Button
                  size="sm"
                  className="h-7 text-xs flex-1"
                  onClick={handleAdd}
                  disabled={!targetId || addMut.isPending}
                >
                  {addMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Ekle'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => { setShowAdd(false); setTargetId(''); }}
                >
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
