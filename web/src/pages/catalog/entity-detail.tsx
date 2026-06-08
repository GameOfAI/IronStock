/**
 * EntityDetailPage — Backstage-style entity detail via catalog URL (PR-DP06).
 * Route: /catalog/:kind/:namespace/:name
 *
 * Shows EntityHeader + entity overview metadata.
 * Full encrypted field access remains at /inventory?item=uuid (existing flow).
 */

import * as React from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertCircle, Loader2 } from 'lucide-react';
import { EntityHeader } from '@/components/catalog/entity-header';
import { useFindItemByKindAndName } from '@/api/catalog-browser';
import { useItemAnnotationsQuery } from '@/api/annotations';

export default function EntityDetailPage() {
  const { kind = '', name = '' } = useParams<{
    kind: string;
    namespace: string;
    name: string;
  }>();

  const { data: item, isLoading, error } = useFindItemByKindAndName(kind, name);
  const { data: annotationsData } = useItemAnnotationsQuery(item?.id ?? null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }

  if (error || !item) {
    const notFound = !item || (error as Error)?.message === 'not-found';
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-slate-600" />
        <p className="text-[14px] font-medium text-slate-400">
          {notFound ? 'Entity bulunamadı' : 'Yükleme hatası'}
        </p>
        <p className="text-[12px] text-slate-600">
          {notFound
            ? `${kind}/${decodeURIComponent(name)} bulunamadı veya erişim izniniz yok.`
            : (error as Error)?.message}
        </p>
        <Link
          to="/catalog"
          className="mt-2 rounded-md border border-slate-700 px-3 py-1.5 text-[12px] text-slate-400 hover:border-slate-600 hover:text-slate-200"
        >
          Catalog&apos;a Dön
        </Link>
      </div>
    );
  }

  const annotations = annotationsData?.annotations ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <EntityHeader item={item} />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Annotations section */}
          {annotations.length > 0 && (
            <section>
              <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Annotations
              </h2>
              <div className="rounded-lg border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
                {annotations.map((a) => (
                  <div key={a.key} className="flex items-baseline gap-3 px-4 py-2.5">
                    <span className="w-48 shrink-0 font-mono text-[11px] text-slate-400 truncate">
                      {a.key}
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] text-slate-300 truncate">
                      {a.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Metadata section */}
          <section>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Metadata
            </h2>
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 divide-y divide-slate-800">
              <MetaRow label="ID" value={item.id} mono />
              <MetaRow label="Kind" value={item.kind ?? '—'} mono />
              <MetaRow label="Owner" value={item.owner_ref ? `${item.owner_ref.kind}:${item.owner_ref.name}` : '—'} />
              <MetaRow label="Oluşturulma" value={new Date(item.created_at).toLocaleString('tr-TR')} />
              <MetaRow label="Güncelleme" value={new Date(item.updated_at).toLocaleString('tr-TR')} />
              {item.expires_at && (
                <MetaRow
                  label="Son Kullanım"
                  value={new Date(item.expires_at).toLocaleString('tr-TR')}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3 px-4 py-2.5">
      <span className="w-32 shrink-0 text-[11px] text-slate-500">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-[12px] text-slate-300 ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
