/**
 * ItemDetail — sağ panel, seçili item metadata + alan listesi.
 *
 * PR-C5: owner_dek_wrapped sunucuda varsa (PR-13 sonrası) decrypt edilir.
 * Yoksa amber "Şifreli" placeholder korunur.
 *
 * Clipboard: navigator.clipboard + 30sn auto-clear.
 */

import * as React from 'react';
import { Check, Copy, Eye, EyeOff, Loader2, Lock, MousePointerClick, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { FieldDefinition, ItemFieldOutput, ItemType } from '@/api/types';
import { useItem } from '@/api/items';
import { useAuthStore } from '@/store/auth';
import { openDEKWithKEK, decryptField, fromBase64 } from '@/lib/crypto';
import { PermissionBadge } from './permission-badge';
import { RelativeTime } from '@/components/common/relative-time';

const CLIPBOARD_CLEAR_MS = 30_000;

interface ItemDetailProps {
  itemId: string | null;
  fieldDefinitions: FieldDefinition[];
  itemTypes: ItemType[];
}

function findItemTypeLabel(types: ItemType[], typeId: number): string {
  return types.find((t) => t.id === typeId)?.label ?? `tip:${typeId}`;
}

function buildFieldDefMap(defs: FieldDefinition[]): Map<number, FieldDefinition> {
  const map = new Map<number, FieldDefinition>();
  for (const d of defs) map.set(d.id, d);
  return map;
}

type DecryptState =
  | { status: 'idle' }
  | { status: 'decrypting' }
  | { status: 'done'; values: Map<string, string> }
  | { status: 'error'; message: string };

interface FieldRowProps {
  field: ItemFieldOutput;
  definition: FieldDefinition | undefined;
  decryptedValue: string | undefined;
  canDecrypt: boolean;
}

function FieldRow({ field, definition, decryptedValue, canDecrypt }: FieldRowProps) {
  const label = definition?.label ?? `alan:${field.field_definition_id}`;
  const key = definition?.key;
  const isSecret = definition?.is_secret ?? true;
  const [visible, setVisible] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const clearTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  async function handleCopy() {
    if (!decryptedValue) return;
    try {
      await navigator.clipboard.writeText(decryptedValue);
      setCopied(true);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(async () => {
        // Pano içeriğini 30 saniye sonra temizle
        try {
          await navigator.clipboard.writeText('');
        } catch {
          // Ignore — clipboard permission might have been revoked
        }
        setCopied(false);
        clearTimer.current = null;
      }, CLIPBOARD_CLEAR_MS);
    } catch {
      // Clipboard API erişim hatası — sessizce geç
    }
  }

  React.useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  const fieldKey = `${field.field_definition_id}-${field.position}`;

  return (
    <div key={fieldKey} className="grid grid-cols-[140px_1fr] items-start gap-3 border-b py-2 last:border-b-0">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        {key && (
          <div className="font-mono text-[10px] uppercase text-muted-foreground">{key}</div>
        )}
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {decryptedValue !== undefined ? (
          <>
            <span
              className={`flex-1 truncate font-mono text-xs ${isSecret && !visible ? 'blur-sm select-none' : ''}`}
              aria-label={isSecret && !visible ? 'Değer gizli' : undefined}
            >
              {decryptedValue}
            </span>
            {isSecret && (
              <button
                type="button"
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'Gizle' : 'Göster'}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Kopyala (30sn sonra temizlenir)"
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </>
        ) : canDecrypt ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground italic">
            <Loader2 className="h-3 w-3 animate-spin" />
            Çözümleniyor…
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
            <Lock className="h-3 w-3" aria-hidden />
            Şifreli
          </span>
        )}
      </div>
    </div>
  );
}

export function ItemDetail({ itemId, fieldDefinitions, itemTypes }: ItemDetailProps) {
  const itemQuery = useItem(itemId);
  const privateKey = useAuthStore((s) => s.privateKey);
  const [decryptState, setDecryptState] = React.useState<DecryptState>({ status: 'idle' });

  const item = itemQuery.data;
  const canDecrypt = Boolean(item?.owner_dek_wrapped && item?.owner_wrap_nonce && privateKey);

  // DEK açma + alan çözümleme — item veya privateKey değişince tetiklenir
  React.useEffect(() => {
    if (!item || !item.owner_dek_wrapped || !item.owner_wrap_nonce || !privateKey) {
      setDecryptState({ status: 'idle' });
      return;
    }
    const fields = item.fields ?? [];
    if (fields.length === 0) {
      setDecryptState({ status: 'done', values: new Map() });
      return;
    }

    let cancelled = false;
    setDecryptState({ status: 'decrypting' });

    (async () => {
      try {
        const wrapped = fromBase64(item.owner_dek_wrapped!);
        const nonce = fromBase64(item.owner_wrap_nonce!);
        const dek = await openDEKWithKEK(wrapped, nonce, privateKey);

        const values = new Map<string, string>();
        await Promise.all(
          fields.map(async (f) => {
            if (!f.value_enc || !f.value_nonce) return;
            const valueEnc = fromBase64(f.value_enc);
            const valueNonce = fromBase64(f.value_nonce);
            const plain = await decryptField(valueEnc, valueNonce, dek);
            values.set(`${f.field_definition_id}-${f.position}`, plain);
          }),
        );

        if (!cancelled) setDecryptState({ status: 'done', values });
      } catch (err) {
        if (!cancelled)
          setDecryptState({ status: 'error', message: err instanceof Error ? err.message : 'Çözümleme hatası' });
      }
    })();

    return () => { cancelled = true; };
  }, [item, privateKey]);

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
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (itemQuery.isError || !item) {
    return (
      <div className="p-4 text-sm text-red-600">
        Item okunamadı.{' '}
        <button type="button" onClick={() => itemQuery.refetch()} className="underline">
          Tekrar dene
        </button>
      </div>
    );
  }

  const fieldDefMap = buildFieldDefMap(fieldDefinitions);
  const fields = (item.fields ?? []).slice().sort((a, b) => a.position - b.position);
  const decryptedValues = decryptState.status === 'done' ? decryptState.values : new Map<string, string>();

  return (
    <div className="space-y-5 p-4">
      <header className="space-y-2">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-md bg-muted p-2">
            <Package className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <div className="flex-1 space-y-1">
            <h2 className="text-lg font-semibold leading-tight">{item.name}</h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{findItemTypeLabel(itemTypes, item.item_type_id)}</span>
              <span aria-hidden>·</span>
              <PermissionBadge permission={item.permission} />
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div>
            <dt className="text-muted-foreground">Oluşturulma</dt>
            <dd><RelativeTime iso={item.created_at} /></dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Güncellenme</dt>
            <dd><RelativeTime iso={item.updated_at} /></dd>
          </div>
        </dl>
      </header>

      {decryptState.status === 'error' && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-xs text-destructive">
          Çözümleme hatası: {decryptState.message}
        </div>
      )}

      {!canDecrypt && item.fields && item.fields.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Alan değerleri henüz gösterilemiyor — sunucu DEK erişimi PR-13 sonrası aktif olur.
        </p>
      )}

      <section aria-label="Alanlar">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Alanlar</h3>
          <span className="text-xs text-muted-foreground">{fields.length} alan</span>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Bu item'da alan tanımlı değil.</p>
        ) : (
          <div className="rounded-md border">
            <div className="px-3">
              {fields.map((f) => (
                <FieldRow
                  key={`${f.field_definition_id}-${f.position}`}
                  field={f}
                  definition={fieldDefMap.get(f.field_definition_id)}
                  decryptedValue={decryptedValues.get(`${f.field_definition_id}-${f.position}`)}
                  canDecrypt={canDecrypt}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {itemQuery.isFetching && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Güncelleniyor…
        </div>
      )}
    </div>
  );
}
