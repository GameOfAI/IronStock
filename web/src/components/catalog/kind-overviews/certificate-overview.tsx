import * as React from 'react';
import type { Item } from '@/api/types';
import { useItemAnnotationsQuery } from '@/api/annotations';
import { ShieldCheck, AlertTriangle, Clock, User, Globe } from 'lucide-react';
import { cn } from '@/lib/cn';

const ANNOTATION_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  'cert/issuer':  { label: 'Issuer',  icon: User },
  'cert/subject': { label: 'Subject', icon: ShieldCheck },
  'cert/sans':    { label: 'SANs',    icon: Globe },
};

function ExpiryBadge({ expiresAt }: { expiresAt: string }) {
  const expDate = new Date(expiresAt);
  const now = new Date();
  const diffMs = expDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  const isExpired = diffDays < 0;
  const isUrgent = !isExpired && diffDays <= 7;
  const isWarning = !isExpired && diffDays <= 30;

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm',
        isExpired && 'border-red-700/50 bg-red-900/20 text-red-300',
        isUrgent && 'border-orange-700/50 bg-orange-900/20 text-orange-300',
        isWarning && !isUrgent && 'border-amber-700/50 bg-amber-900/20 text-amber-300',
        !isExpired && !isWarning && 'border-emerald-700/50 bg-emerald-900/20 text-emerald-300',
      )}
    >
      {isExpired || isUrgent ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : (
        <Clock className="h-4 w-4 shrink-0" />
      )}
      <div>
        <p className="font-medium">
          {isExpired
            ? 'Sertifika Süresi Doldu'
            : isUrgent
              ? `${diffDays} gün içinde sona eriyor`
              : isWarning
                ? `${diffDays} gün içinde sona eriyor`
                : `${diffDays} gün geçerli`}
        </p>
        <p className="text-[11px] opacity-75">
          {expDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>
    </div>
  );
}

export function CertificateOverviewTab({ entity }: { entity: Item }) {
  const { data, isLoading } = useItemAnnotationsQuery(entity.id);
  const annotations = data?.annotations ?? [];

  const relevant = annotations.filter((a) => ANNOTATION_LABELS[a.key]);
  const rest = annotations.filter((a) => !ANNOTATION_LABELS[a.key]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
        <ShieldCheck className="h-4 w-4 text-amber-400" />
        Sertifika Bilgileri
      </div>

      {entity.expires_at && <ExpiryBadge expiresAt={entity.expires_at} />}

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded border border-slate-800 bg-slate-900/40" />
          ))}
        </div>
      )}

      {!isLoading && relevant.length === 0 && rest.length === 0 && !entity.expires_at && (
        <p className="text-xs italic text-slate-500">
          Henüz annotation eklenmemiş. cert/issuer, cert/subject, cert/sans ekleyebilirsiniz.
        </p>
      )}

      {relevant.length > 0 && (
        <div className="space-y-2">
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
                  <p className="break-all text-[12px] font-mono text-slate-200">{a.value}</p>
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
