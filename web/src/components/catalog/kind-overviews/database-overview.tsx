import * as React from 'react';
import type { Item } from '@/api/types';
import { useItemAnnotationsQuery } from '@/api/annotations';
import { Database, Server, Hash, Globe } from 'lucide-react';

const ANNOTATION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  'db/engine':        { label: 'Motor',       icon: Database },
  'db/version':       { label: 'Versiyon',    icon: Hash },
  'db/hostname':      { label: 'Hostname',    icon: Server },
  'db/port':          { label: 'Port',        icon: Globe },
  'db/database-name': { label: 'Veritabanı',  icon: Database },
  'db/schema':        { label: 'Şema',        icon: Database },
  'grafana/dashboard-url': { label: 'Grafana', icon: Globe },
};

export function DatabaseOverviewTab({ entity }: { entity: Item }) {
  const { data, isLoading } = useItemAnnotationsQuery(entity.id);
  const annotations = data?.annotations ?? [];

  const relevant = annotations.filter((a) => ANNOTATION_LABELS[a.key]);
  const rest = annotations.filter((a) => !ANNOTATION_LABELS[a.key]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Database className="h-4 w-4 text-emerald-400" />
        Veritabanı Bilgileri
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {!isLoading && relevant.length === 0 && rest.length === 0 && (
        <p className="text-xs italic text-slate-500">
          Henüz annotation eklenmemiş. Veritabanı metadata'sı için Genel sekmesini kullanın.
        </p>
      )}

      {relevant.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {relevant.map((a) => {
            const meta = ANNOTATION_LABELS[a.key];
            const Icon = meta.icon;
            return (
              <div
                key={a.key}
                className="flex items-start gap-2 rounded-md border border-slate-800 bg-slate-900/50 px-3 py-2"
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wide text-slate-500">{meta.label}</p>
                  <p className="truncate text-[13px] font-mono text-slate-200">{a.value}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Diğer Annotation'lar
          </p>
          <div className="divide-y divide-slate-800 rounded-md border border-slate-800">
            {rest.map((a) => (
              <div key={a.key} className="flex items-center gap-2 px-3 py-2 text-[12px]">
                <span className="w-48 shrink-0 truncate font-mono text-slate-400">{a.key}</span>
                <span className="min-w-0 truncate text-slate-300">{a.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
