/**
 * CatalogItemCard — Backstage-style entity card for the /catalog page.
 *
 * Shows server-side metadata only (name, type, folder, health, tags,
 * lifecycle stages, relationships). No secret field values are displayed.
 */

import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Clock,
  ExternalLink,
  GitBranch,
  Tag as TagIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS } from '@/components/pipeline/pipeline-constants';
import type { CatalogItem } from '@/api/catalog-browse';
import type { LifecycleStage } from '@/api/types';

// --- TYPE_COLORS (mirrors item-list.tsx) ---

const TYPE_COLORS: Record<number, { bg: string; icon: string; bd: string }> = {
  1:  { bg: 'bg-sky-500/10',     icon: 'text-sky-400',     bd: 'border-sky-500/30' },
  2:  { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', bd: 'border-emerald-500/30' },
  3:  { bg: 'bg-violet-500/10',  icon: 'text-violet-400',  bd: 'border-violet-500/30' },
  4:  { bg: 'bg-amber-500/10',   icon: 'text-amber-400',   bd: 'border-amber-500/30' },
  5:  { bg: 'bg-rose-500/10',    icon: 'text-rose-400',    bd: 'border-rose-500/30' },
  6:  { bg: 'bg-slate-500/10',   icon: 'text-slate-400',   bd: 'border-slate-500/30' },
  7:  { bg: 'bg-pink-500/10',    icon: 'text-pink-400',    bd: 'border-pink-500/30' },
  8:  { bg: 'bg-cyan-500/10',    icon: 'text-cyan-400',    bd: 'border-cyan-500/30' },
  9:  { bg: 'bg-red-500/10',     icon: 'text-red-400',     bd: 'border-red-500/30' },
  10: { bg: 'bg-blue-500/10',    icon: 'text-blue-400',    bd: 'border-blue-500/30' },
  11: { bg: 'bg-teal-500/10',    icon: 'text-teal-400',    bd: 'border-teal-500/30' },
  12: { bg: 'bg-orange-500/10',  icon: 'text-orange-400',  bd: 'border-orange-500/30' },
};

const FALLBACK_COLOR = { bg: 'bg-slate-500/10', icon: 'text-slate-400', bd: 'border-slate-500/30' };

// --- Health badge ---

function HealthBadge({ score, severity }: { score: number | null; severity: string | null }) {
  if (score === null || severity === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-slate-800 text-slate-500">
        N/A
      </span>
    );
  }
  const color =
    severity === 'healthy'
      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      : severity === 'warning'
        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
        : 'bg-red-500/10 text-red-400 border border-red-500/20';
  const dot =
    severity === 'healthy'
      ? 'bg-emerald-400'
      : severity === 'warning'
        ? 'bg-amber-400'
        : 'bg-red-400';

  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium', color)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {score}
    </span>
  );
}

// --- Expiry warning ---

function ExpiryChip({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  if (exp > now + 7 * 24 * 60 * 60 * 1000) return null; // more than 7 days — no chip

  const isExpired = exp <= now;
  const label = isExpired
    ? `Süresi doldu`
    : `${Math.ceil((exp - now) / (24 * 60 * 60 * 1000))}g içinde sona erer`;

  return (
    <span className={cn(
      'inline-flex items-center gap-0.5 text-[10px] font-medium',
      isExpired ? 'text-destructive' : 'text-amber-400',
    )}>
      {isExpired ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
      {label}
    </span>
  );
}

// --- Props ---

export interface CatalogItemCardProps {
  item: CatalogItem;
  lifecycleStages: LifecycleStage[];
  isSelected: boolean;
  onSelect: (item: CatalogItem) => void;
}

// --- Component ---

export function CatalogItemCard({ item, lifecycleStages, isSelected, onSelect }: CatalogItemCardProps) {
  const TypeIcon = PIPELINE_TYPE_ICONS[item.item_type_id] ?? PIPELINE_TYPE_ICONS[6];
  const typeLabel = PIPELINE_TYPE_LABELS[item.item_type_id] ?? 'Öğe';
  const colors = TYPE_COLORS[item.item_type_id] ?? FALLBACK_COLOR;

  const assignedStages = lifecycleStages.filter((s) =>
    item.lifecycle_stage_ids.includes(s.id),
  );

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        'group relative w-full rounded-xl border bg-slate-900 p-4 text-left transition-all',
        'hover:border-slate-600 hover:bg-slate-800/80 hover:shadow-lg hover:shadow-black/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        isSelected
          ? 'border-blue-500/60 bg-slate-800/80 shadow-lg shadow-blue-500/10'
          : 'border-slate-800',
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* Type icon */}
          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', colors.bg)}>
            <TypeIcon className={cn('h-4 w-4', colors.icon)} />
          </div>
          {/* Name + type badge */}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100 leading-tight">
              {item.name || '—'}
            </p>
            <span className={cn(
              'inline-block mt-0.5 rounded px-1.5 py-px text-[10px] font-medium border',
              colors.bg, colors.icon, colors.bd,
            )}>
              {typeLabel}
            </span>
          </div>
        </div>

        {/* Health badge (top-right) */}
        <div className="shrink-0">
          <HealthBadge score={item.health_score} severity={item.health_severity} />
        </div>
      </div>

      {/* Folder path */}
      <p className="mt-2 truncate text-[11px] text-slate-500">
        📁 {item.folder_name || item.folder_id.slice(0, 8)}
      </p>

      {/* Description */}
      {item.description && (
        <p className="mt-1.5 line-clamp-2 text-[12px] text-slate-400 leading-relaxed">
          {item.description}
        </p>
      )}

      {/* Lifecycle stage pills */}
      {assignedStages.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1">
          {assignedStages.map((stage) => (
            <span
              key={stage.id}
              className="inline-block rounded-full px-2 py-px text-[10px] font-medium text-white"
              style={{ backgroundColor: stage.color + '33', color: stage.color }}
            >
              {stage.label}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      {item.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="inline-flex items-center gap-0.5 rounded px-1.5 py-px text-[10px] bg-slate-800 text-slate-400 border border-slate-700">
              <TagIcon className="h-2.5 w-2.5" />
              {tag}
            </span>
          ))}
          {item.tags.length > 4 && (
            <span className="text-[10px] text-slate-500">+{item.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer row */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          {item.relationship_count > 0 && (
            <span className="flex items-center gap-1">
              <GitBranch className="h-3 w-3" />
              {item.relationship_count} bağlantı
            </span>
          )}
          <ExpiryChip expiresAt={item.expires_at} />
        </div>

        {/* Inventory deep-link */}
        <Link
          to={`/inventory?folder=${item.folder_id}&item=${item.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          title="Envanterde aç"
        >
          <ExternalLink className="h-3 w-3" />
          Aç
        </Link>
      </div>
    </button>
  );
}
