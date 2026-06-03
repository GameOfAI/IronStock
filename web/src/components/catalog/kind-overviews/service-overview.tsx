import * as React from 'react';
import type { Item } from '@/api/types';
import { useItemAnnotationsQuery } from '@/api/annotations';
import { Globe, Tag, Layers, Code2 } from 'lucide-react';

const ANNOTATION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  'service/url':         { label: 'URL',          icon: Globe },
  'service/protocol':    { label: 'Protokol',     icon: Code2 },
  'service/environment': { label: 'Ortam',        icon: Layers },
  'service/version':     { label: 'Versiyon',     icon: Tag },
  'github.com/project-slug': { label: 'GitHub',   icon: Code2 },
  'grafana/dashboard-url':   { label: 'Grafana',  icon: Globe },
};

export function ServiceOverviewTab({ entity }: { entity: Item }) {
  const { data, isLoading } = useItemAnnotationsQuery(entity.id);
  const annotations = data?.annotations ?? [];

  const relevant = annotations.filter((a) => ANNOTATION_LABELS[a.key]);
  const rest = annotations.filter((a) => !ANNOTATION_LABELS[a.key]);

  const serviceUrl = annotations.find((a) => a.key === 'service/url')?.value;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <Globe className="h-4 w-4 text-violet-400" />
        Servis Bilgileri
      </div>

      {serviceUrl && (
        <a
          href={serviceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-700/50 bg-violet-900/20 px-3 py-1.5 text-[12px] text-violet-300 hover:bg-violet-900/40"
        >
          <Globe className="h-3 w-3" />
          {serviceUrl}
        </a>
      )}

      {isLoading && (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {!isLoading && relevant.length === 0 && rest.length === 0 && (
        <p className="text-xs italic text-slate-500">
          Henüz annotation eklenmemiş. Servis bilgileri için Genel sekmesini kullanın.
        </p>
      )}

      {relevant.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {relevant
            .filter((a) => a.key !== 'service/url')
            .map((a) => {
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
