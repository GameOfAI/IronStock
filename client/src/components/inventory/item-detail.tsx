/**
 * ItemDetail — sağ panel, seçili item metadata + alan listesi.
 *
 * Alanlar PR-C4'te amber "şifreli" placeholder olarak gösterilir.
 * Gerçek decrypt PR-C5'te eklenir (DEK açma + değer gösterme).
 */

import { Lock, Loader2, MousePointerClick, Package } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import type { FieldDefinition, ItemType } from '@/api/types';
import { useItem } from '@/api/items';
import { PermissionBadge } from './permission-badge';
import { RelativeTime } from '@/components/common/relative-time';

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

export function ItemDetail({ itemId, fieldDefinitions, itemTypes }: ItemDetailProps) {
  const itemQuery = useItem(itemId);

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

  if (itemQuery.isError || !itemQuery.data) {
    return (
      <div className="p-4 text-sm text-red-600">
        Item okunamadı.{' '}
        <button type="button" onClick={() => itemQuery.refetch()} className="underline">
          Tekrar dene
        </button>
      </div>
    );
  }

  const item = itemQuery.data;
  const fieldDefMap = buildFieldDefMap(fieldDefinitions);
  const fields = (item.fields ?? []).slice().sort((a, b) => a.position - b.position);

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

      <section aria-label="Alanlar">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">Alanlar</h3>
          <span className="text-xs text-muted-foreground">{fields.length} alan</span>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Bu item'da alan tanımlı değil.</p>
        ) : (
          <div className="divide-y rounded-md border">
            {fields.map((f) => {
              const def = fieldDefMap.get(f.field_definition_id);
              const label = def?.label ?? `alan:${f.field_definition_id}`;
              const isSecret = def?.is_secret ?? true;
              return (
                <div key={`${f.field_definition_id}-${f.position}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  {isSecret ? (
                    <span className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                      <Lock className="h-3 w-3" aria-hidden />
                      Şifreli
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">— (düz metin)</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {fields.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Şifreli alanlar PR-C5'te açılabilecek.
          </p>
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
