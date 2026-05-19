/**
 * ItemList — orta panel, seçili klasördeki item'lar.
 *
 * PR-UX6: Table → icon-row kart tasarımı, renkli tip ikonları.
 */

import { AlertTriangle, Clock, Inbox, Loader2, PackageSearch } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import type { Item, ItemType } from '@/api/types';
import { PermissionBadge } from './permission-badge';
import { RelativeTime } from '@/components/common/relative-time';
import { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS } from '@/components/pipeline/pipeline-constants';

interface ItemListProps {
  items: Item[] | undefined;
  isLoading: boolean;
  isError: boolean;
  /** Klasör seçilmediyse list pasif. */
  folderSelected: boolean;
  /** Search query — empty result mesajı için. */
  searchQuery: string;
  selectedItemId: string | null;
  onSelect(id: string): void;
  itemTypes: ItemType[];
}

// Tip bazlı ikon renk haritası — matches design handoff COLOR_MAP
// { bg: icon-bg, icon: icon-color, bd: badge-border, dot: badge-dot }
const TYPE_COLORS: Record<number, { bg: string; icon: string; bd: string; dot: string }> = {
  1:  { bg: 'bg-sky-500/10',     icon: 'text-sky-400',     bd: 'border-sky-500/30',     dot: 'bg-sky-400' },     // Sunucu
  2:  { bg: 'bg-emerald-500/10', icon: 'text-emerald-400', bd: 'border-emerald-500/30', dot: 'bg-emerald-400' }, // URL
  3:  { bg: 'bg-violet-500/10',  icon: 'text-violet-400',  bd: 'border-violet-500/30',  dot: 'bg-violet-400' },  // Veritabanı
  4:  { bg: 'bg-amber-500/10',   icon: 'text-amber-400',   bd: 'border-amber-500/30',   dot: 'bg-amber-400' },   // SSH Anh.
  5:  { bg: 'bg-rose-500/10',    icon: 'text-rose-400',    bd: 'border-rose-500/30',    dot: 'bg-rose-400' },    // API Anh.
  6:  { bg: 'bg-slate-500/10',   icon: 'text-slate-400',   bd: 'border-slate-500/30',   dot: 'bg-slate-400' },   // Genel
  7:  { bg: 'bg-pink-500/10',    icon: 'text-pink-400',    bd: 'border-pink-500/30',    dot: 'bg-pink-400' },    // CI/CD
  8:  { bg: 'bg-cyan-500/10',    icon: 'text-cyan-400',    bd: 'border-cyan-500/30',    dot: 'bg-cyan-400' },    // Registry
  9:  { bg: 'bg-red-500/10',     icon: 'text-red-400',     bd: 'border-red-500/30',     dot: 'bg-red-400' },     // Güvenlik
  10: { bg: 'bg-blue-500/10',    icon: 'text-blue-400',    bd: 'border-blue-500/30',    dot: 'bg-blue-400' },    // CPU/HW
  11: { bg: 'bg-teal-500/10',    icon: 'text-teal-400',    bd: 'border-teal-500/30',    dot: 'bg-teal-400' },    // Bulut
  12: { bg: 'bg-orange-500/10',  icon: 'text-orange-400',  bd: 'border-orange-500/30',  dot: 'bg-orange-400' },  // Kaynak Kod
};

// --- Expiry badge (PR-N1) ---

type ExpiryStatus = 'expired' | 'warning' | null;

function getExpiryStatus(expiresAt?: string | null): ExpiryStatus {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt).getTime();
  const now = Date.now();
  if (exp <= now) return 'expired';
  if (exp <= now + 7 * 24 * 60 * 60 * 1000) return 'warning';
  return null;
}

function ExpiryBadge({ expiresAt }: { expiresAt?: string | null }) {
  const status = getExpiryStatus(expiresAt);
  if (!status) return null;

  const isExpired = status === 'expired';
  const label = isExpired
    ? `Süresi doldu: ${new Date(expiresAt!).toLocaleDateString('tr-TR')}`
    : `Süresi yaklaşıyor: ${new Date(expiresAt!).toLocaleDateString('tr-TR')}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium gap-0.5',
            isExpired
              ? 'bg-destructive/10 text-destructive'
              : 'bg-amber-500/10 text-amber-500',
          )}
        >
          {isExpired ? (
            <AlertTriangle className="h-3 w-3" aria-label={label} />
          ) : (
            <Clock className="h-3 w-3" aria-label={label} />
          )}
          {isExpired ? 'Süresi doldu' : 'Yaklaşıyor'}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b">
      <Skeleton className="h-8 w-8 rounded-md shrink-0" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-3 w-20" />
      </div>
      <Skeleton className="h-3 w-12 shrink-0" />
    </div>
  );
}

function ItemRow({
  item,
  selected,
  onSelect,
}: {
  item: Item;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeId = item.item_type_id;
  const Icon = PIPELINE_TYPE_ICONS[typeId] ?? PackageSearch;
  const typeLabel = PIPELINE_TYPE_LABELS[typeId] ?? `tip:${typeId}`;
  const colors = TYPE_COLORS[typeId] ?? {
    bg: 'bg-slate-500/10',
    icon: 'text-slate-400',
    bd: 'border-slate-500/30',
    dot: 'bg-slate-400',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={cn(
        'group mx-2 mb-1 flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500',
        selected
          ? 'border-blue-500/60 bg-blue-600/10'
          : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/70',
      )}
    >
      {/* Renkli tip ikonu */}
      <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', colors.bg)}>
        <Icon className={cn('h-4 w-4', colors.icon)} aria-hidden />
      </div>

      {/* Ana içerik */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('truncate text-[13px] font-medium leading-tight', selected ? 'text-slate-100' : 'text-slate-200')}>
            {item.name}
          </span>
          <ExpiryBadge expiresAt={item.expires_at} />
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          {/* Type badge */}
          <span className={cn('inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide', colors.bd, colors.icon, 'bg-transparent')}>
            <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', colors.dot)} />
            {typeLabel}
          </span>
          <PermissionBadge permission={item.permission} compact />
        </div>
      </div>

      {/* Güncelleme zamanı */}
      <div className="shrink-0 font-mono text-[10px] text-slate-500">
        <RelativeTime iso={item.updated_at} />
      </div>
    </div>
  );
}

export function ItemList({
  items,
  isLoading,
  isError,
  folderSelected,
  searchQuery,
  selectedItemId,
  onSelect,
}: ItemListProps) {
  if (!folderSelected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <PackageSearch className="h-8 w-8" aria-hidden />
        <p className="text-sm">Soldan bir klasör seçin.</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="py-12 text-center text-sm text-red-600">
        Item listesi alınamadı.
      </div>
    );
  }

  if (isLoading && !items) {
    return (
      <div>
        {Array.from({ length: 5 }, (_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <Inbox className="h-6 w-6" aria-hidden />
        )}
        <span className="text-sm">
          {searchQuery
            ? `"${searchQuery}" araması ile eşleşen item yok.`
            : 'Bu klasörde item yok.'}
        </span>
      </div>
    );
  }

  return (
    <div role="list" className="py-2">
      {items.map((item) => (
        <ItemRow
          key={item.id}
          item={item}
          selected={selectedItemId === item.id}
          onSelect={() => onSelect(item.id)}
        />
      ))}
    </div>
  );
}
