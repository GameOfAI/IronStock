import * as React from 'react';
import {
  Server,
  Globe,
  Database,
  Key,
  ShieldCheck,
  Cloud,
  FileText,
  Lock,
  HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Item } from '@/api/types';

const kindStyle: Record<
  string,
  { icon: React.ElementType; bg: string; text: string; border: string }
> = {
  Server:          { icon: Server,      bg: 'bg-sky-500/10',     text: 'text-sky-400',     border: 'border-sky-500/30' },
  Service:         { icon: Globe,       bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  Database:        { icon: Database,    bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'border-violet-500/30' },
  SSHKey:          { icon: Key,         bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/30' },
  Certificate:     { icon: ShieldCheck, bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/30' },
  CloudCredential: { icon: Cloud,       bg: 'bg-teal-500/10',    text: 'text-teal-400',    border: 'border-teal-500/30' },
  Note:            { icon: FileText,    bg: 'bg-slate-500/10',   text: 'text-slate-400',   border: 'border-slate-500/30' },
  Credential:      { icon: Lock,        bg: 'bg-blue-500/10',    text: 'text-blue-400',    border: 'border-blue-500/30' },
};

const defaultStyle = {
  icon: HelpCircle,
  bg: 'bg-slate-500/10',
  text: 'text-slate-400',
  border: 'border-slate-500/30',
};

interface EntityCardProps {
  item: Item;
  onClick?: () => void;
}

export function EntityCard({ item, onClick }: EntityCardProps) {
  const style = item.kind ? (kindStyle[item.kind] ?? defaultStyle) : defaultStyle;
  const Icon = style.icon;

  const now = Date.now();
  const expiresAt = item.expires_at ? new Date(item.expires_at).getTime() : null;
  const isExpired = expiresAt !== null && expiresAt <= now;
  const expiringSoon = !isExpired && expiresAt !== null && expiresAt - now < 7 * 86_400_000;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-4 transition-colors cursor-pointer',
        style.border,
        'hover:bg-accent',
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', style.bg)}>
          <Icon className={cn('h-4 w-4', style.text)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{item.name}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{item.description}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {item.kind && (
          <span
            className={cn(
              'inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
              style.bg,
              style.text,
            )}
          >
            {item.kind}
          </span>
        )}
        {item.owner_ref && (
          <span className="inline-flex items-center rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {item.owner_ref.name}
          </span>
        )}
        {isExpired && (
          <span className="inline-flex items-center rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] text-destructive">
            Süresi doldu
          </span>
        )}
        {expiringSoon && (
          <span className="inline-flex items-center rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">
            Yakında bitiyor
          </span>
        )}
      </div>
    </div>
  );
}
