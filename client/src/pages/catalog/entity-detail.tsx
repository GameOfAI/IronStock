import * as React from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertCircle,
  Loader2,
  Server,
  Globe,
  Database,
  Key,
  ShieldCheck,
  Cloud,
  FileText,
  Lock,
  HelpCircle,
  ArrowLeft,
  Heart,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useCatalogEntityQuery } from '@/api/catalog-browser';
import type { CatalogEntityResponse } from '@/api/catalog-browser';

const KIND_ICON: Record<string, React.ElementType> = {
  Server: Server, Service: Globe, Database: Database,
  SSHKey: Key, Certificate: ShieldCheck, CloudCredential: Cloud,
  Note: FileText, Credential: Lock,
};

const KIND_COLOR: Record<string, string> = {
  Server: 'text-sky-400', Service: 'text-emerald-400', Database: 'text-violet-400',
  SSHKey: 'text-amber-400', Certificate: 'text-rose-400', CloudCredential: 'text-teal-400',
  Note: 'text-slate-400', Credential: 'text-blue-400',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-500 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  healthy: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30',
};

export default function EntityDetailPage() {
  const { kind = '', name = '' } = useParams<{
    kind: string;
    namespace: string;
    name: string;
  }>();

  const decodedName = decodeURIComponent(name);
  const { data, isLoading, error } = useCatalogEntityQuery(kind, decodedName);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">Entity bulunamadı</p>
        <p className="text-xs text-muted-foreground/60">
          {kind}/{decodedName} bulunamadı veya erişim izniniz yok.
        </p>
        <Link
          to="/catalog"
          className="mt-2 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          Catalog'a Dön
        </Link>
      </div>
    );
  }

  const { item, annotations, relationships, health } = data;
  const Icon = KIND_ICON[item.kind] ?? HelpCircle;
  const iconColor = KIND_COLOR[item.kind] ?? 'text-muted-foreground';
  const annotationEntries = Object.entries(annotations);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b px-4 py-4">
        <div className="flex items-center gap-3">
          <Link
            to="/catalog"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className={cn('h-5 w-5', iconColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">{item.name}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {item.kind}
              </span>
              {item.owner_ref && (
                <span className="text-[10px] text-muted-foreground">
                  owner: {item.owner_ref.name}
                </span>
              )}
            </div>
          </div>
          {health && (
            <div className="flex items-center gap-2 shrink-0">
              <Heart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-mono tabular-nums">{health.score}</span>
              <span
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-medium',
                  SEVERITY_STYLE[health.severity] ?? '',
                )}
              >
                {health.severity}
              </span>
            </div>
          )}
        </div>
        {item.description && (
          <p className="mt-2 ml-[52px] text-xs text-muted-foreground">{item.description}</p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Annotations */}
          {annotationEntries.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Annotations
              </h2>
              <div className="rounded-lg border divide-y">
                {annotationEntries.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-3 px-4 py-2.5">
                    <span className="w-40 shrink-0 font-mono text-[11px] text-muted-foreground truncate">
                      {key}
                    </span>
                    <span className="min-w-0 flex-1 text-[12px] truncate">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Relationships */}
          {relationships.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                İlişkiler
              </h2>
              <div className="rounded-lg border divide-y">
                {relationships.map((rel, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {rel.backstage_type ?? rel.type}
                    </span>
                    <span className="text-[12px]">
                      {rel.source_id === item.id ? rel.target_id : rel.source_id}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Health breakdown */}
          {health && health.breakdown.length > 0 && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sağlık Detayları
              </h2>
              <div className="rounded-lg border divide-y">
                {health.breakdown.map((b, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <span className="text-[12px]">{b.rule}</span>
                      {b.detail && (
                        <span className="ml-2 text-[11px] text-muted-foreground">{b.detail}</span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-red-400">-{b.deduction}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Metadata */}
          <section>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Metadata
            </h2>
            <div className="rounded-lg border divide-y">
              <MetaRow label="ID" value={item.id} mono />
              <MetaRow label="Kind" value={item.kind} mono />
              <MetaRow label="Owner" value={item.owner_ref ? `${item.owner_ref.kind}:${item.owner_ref.name}` : '—'} />
              <MetaRow label="Oluşturulma" value={new Date(item.created_at).toLocaleString('tr-TR')} />
              <MetaRow label="Güncelleme" value={new Date(item.updated_at).toLocaleString('tr-TR')} />
              {item.expires_at && (
                <MetaRow label="Son Kullanım" value={new Date(item.expires_at).toLocaleString('tr-TR')} />
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
      <span className="w-32 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-[12px]', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  );
}
