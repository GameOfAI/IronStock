/**
 * /catalog — Backstage-style service catalog page (PR-CATALOG).
 *
 * Shows all items the user can access in a card grid view, filterable by:
 * - Item type (chips)
 * - Health severity
 * - Tag
 * - Name search (debounced)
 *
 * Clicking a card opens a side detail panel. The "Envanterde Aç →" link
 * deep-links back to /inventory with folder + item pre-selected.
 *
 * This page is READ-ONLY — no mutations. The inventory page handles all edits.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  ExternalLink,
  GitBranch,
  LayoutGrid,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  Tag as TagIcon,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useCatalogBrowseQuery, type CatalogItem } from '@/api/catalog-browse';
import { useLifecycleStagesQuery } from '@/api/lifecycle';
import { useItemHealthQuery } from '@/api/health';
import { useItemTagsQuery } from '@/api/tags';
import { CatalogItemCard } from '@/components/catalog/catalog-item-card';
import { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS } from '@/components/pipeline/pipeline-constants';
import type { LifecycleStage } from '@/api/types';

// --- Constants ---

const PAGE_SIZE = 48;

const ITEM_TYPE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const SEVERITY_OPTS = [
  { value: 'healthy',  label: 'Sağlıklı',   dot: 'bg-emerald-400' },
  { value: 'warning',  label: 'Uyarı',       dot: 'bg-amber-400' },
  { value: 'critical', label: 'Kritik',      dot: 'bg-red-400' },
] as const;

// --- Helpers ---

function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

// --- Side panel component ---

interface SidePanelProps {
  item: CatalogItem;
  lifecycleStages: LifecycleStage[];
  onClose: () => void;
}

function CatalogSidePanel({ item, lifecycleStages, onClose }: SidePanelProps) {
  const TypeIcon = PIPELINE_TYPE_ICONS[item.item_type_id] ?? PIPELINE_TYPE_ICONS[6];
  const typeLabel = PIPELINE_TYPE_LABELS[item.item_type_id] ?? 'Öğe';

  // Lazy-fetch health breakdown and tags only when panel is open
  const healthQuery = useItemHealthQuery(item.id);
  const tagsQuery = useItemTagsQuery(item.id);

  const assignedStages = lifecycleStages.filter((s) =>
    item.lifecycle_stage_ids.includes(s.id),
  );

  const healthDotColor =
    item.health_severity === 'healthy'
      ? 'bg-emerald-400'
      : item.health_severity === 'warning'
        ? 'bg-amber-400'
        : item.health_severity === 'critical'
          ? 'bg-red-400'
          : 'bg-slate-600';

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-800 bg-slate-900/80">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <TypeIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="truncate text-sm font-semibold text-slate-100">{item.name || '—'}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-5 p-4">
        {/* Type + health */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">{typeLabel}</span>
          {item.health_score !== null && (
            <div className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', healthDotColor)} />
              <span className="font-mono text-[11px] text-slate-300">
                {item.health_score}/100
              </span>
            </div>
          )}
        </div>

        {/* Description */}
        {item.description && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Açıklama</p>
            <p className="text-[13px] text-slate-300 leading-relaxed">{item.description}</p>
          </div>
        )}

        {/* Folder */}
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Klasör</p>
          <p className="text-[13px] text-slate-300">📁 {item.folder_name || item.folder_id.slice(0, 8)}</p>
        </div>

        {/* Health breakdown */}
        {healthQuery.data && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Sağlık Detayı</p>
            <div className="space-y-1.5">
              {healthQuery.data.breakdown.map((b, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{b.rule}</span>
                  <span className="font-mono text-[11px] text-red-400">-{b.deduction}</span>
                </div>
              ))}
              {healthQuery.data.breakdown.length === 0 && (
                <p className="text-[11px] text-emerald-400">Tüm kontroller geçiyor ✓</p>
              )}
            </div>
          </div>
        )}

        {/* Lifecycle stages */}
        {assignedStages.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Lifecycle</p>
            <div className="flex flex-wrap gap-1.5">
              {assignedStages.map((stage) => (
                <span
                  key={stage.id}
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                  style={{ backgroundColor: stage.color + '22', color: stage.color, border: `1px solid ${stage.color}44` }}
                >
                  {stage.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {(tagsQuery.data?.tags?.length ?? item.tags.length) > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Etiketler</p>
            <div className="flex flex-wrap gap-1.5">
              {(tagsQuery.data?.tags ?? item.tags.map((name) => ({ id: name, name, color: null }))).map((tag) => (
                <span
                  key={typeof tag === 'string' ? tag : tag.id}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] bg-slate-800 text-slate-300 border border-slate-700"
                >
                  <TagIcon className="h-2.5 w-2.5 text-slate-500" />
                  {typeof tag === 'string' ? tag : tag.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Bağlantılar</p>
          <div className="flex items-center gap-1.5 text-[13px] text-slate-300">
            <GitBranch className="h-3.5 w-3.5 text-slate-500" />
            {item.relationship_count} ilişki
          </div>
        </div>

        {/* Expiry */}
        {item.expires_at && (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Son Kullanım</p>
            <p className="text-[13px] text-slate-300">
              {new Date(item.expires_at).toLocaleDateString('tr-TR')}
            </p>
          </div>
        )}

        {/* Permission chip */}
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-[11px] text-slate-500 capitalize">{item.permission}</span>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="mt-auto border-t border-slate-800 p-4">
        <Link
          to={`/inventory?folder=${item.folder_id}&item=${item.id}`}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
          Envanterde Aç
        </Link>
      </div>
    </aside>
  );
}

// --- Main page ---

export default function CatalogPage() {
  useDocumentTitle('Servis Kataloğu');

  // Filter state
  const [typeFilter, setTypeFilter] = React.useState<number | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = React.useState<'healthy' | 'warning' | 'critical' | undefined>(undefined);
  const [searchInput, setSearchInput] = React.useState('');
  const [page, setPage] = React.useState(0);

  // Selected item for side panel
  const [selectedItem, setSelectedItem] = React.useState<CatalogItem | null>(null);

  const debouncedSearch = useDebounce(searchInput, 300);

  // Reset page when filters change
  React.useEffect(() => { setPage(0); }, [typeFilter, severityFilter, debouncedSearch]);

  const catalogQuery = useCatalogBrowseQuery({
    type_id: typeFilter,
    severity: severityFilter,
    q: debouncedSearch || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const stagesQuery = useLifecycleStagesQuery();
  const stages = stagesQuery.data?.stages ?? [];

  const items = catalogQuery.data?.items ?? [];
  const total = catalogQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  function handleCardSelect(item: CatalogItem) {
    setSelectedItem((prev) => (prev?.id === item.id ? null : item));
  }

  function clearFilters() {
    setTypeFilter(undefined);
    setSeverityFilter(undefined);
    setSearchInput('');
    setPage(0);
  }

  const hasFilters = typeFilter !== undefined || severityFilter !== undefined || debouncedSearch !== '';

  return (
    <div className="flex h-full flex-col bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-5 w-5 text-slate-400" />
            <div>
              <h1 className="text-base font-semibold text-slate-100">Servis Kataloğu</h1>
              <p className="text-[11px] text-slate-500">
                {catalogQuery.isLoading ? '…' : `${total} öğe`}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => catalogQuery.refetch()}
            disabled={catalogQuery.isFetching}
            className="text-slate-500 hover:text-slate-300"
          >
            <RefreshCw className={cn('h-4 w-4', catalogQuery.isFetching && 'animate-spin')} />
          </Button>
        </div>

        {/* Filter bar */}
        <div className="mt-4 space-y-3">
          {/* Search input */}
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 pointer-events-none" />
            <Input
              placeholder="İsim ara…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8 h-8 text-sm bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
            />
          </div>

          {/* Type chips */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTypeFilter(undefined)}
              className={cn(
                'rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors',
                typeFilter === undefined
                  ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500',
              )}
            >
              Tümü
            </button>
            {ITEM_TYPE_IDS.map((id) => {
              const Icon = PIPELINE_TYPE_ICONS[id];
              const label = PIPELINE_TYPE_LABELS[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTypeFilter(typeFilter === id ? undefined : id)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors',
                    typeFilter === id
                      ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                      : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500',
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Severity + clear */}
          <div className="flex items-center gap-2">
            {SEVERITY_OPTS.map((sev) => (
              <button
                key={sev.value}
                type="button"
                onClick={() => setSeverityFilter(severityFilter === sev.value ? undefined : sev.value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors',
                  severityFilter === sev.value
                    ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', sev.dot)} />
                {sev.label}
              </button>
            ))}
            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X className="h-3 w-3" /> Filtreleri temizle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {catalogQuery.isLoading ? (
            <div className="flex items-center justify-center py-24 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Yükleniyor…
            </div>
          ) : catalogQuery.isError ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
              <p className="text-sm text-destructive">Katalog yüklenirken bir hata oluştu.</p>
              <Button variant="outline" size="sm" onClick={() => catalogQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" /> Tekrar Dene
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <LayoutGrid className="h-10 w-10 text-slate-700" />
              <p className="text-sm font-medium text-slate-400">Sonuç bulunamadı</p>
              <p className="text-[12px] text-slate-600">
                {hasFilters ? 'Filtre kriterlerini değiştirmeyi deneyin.' : 'Henüz erişebildiğiniz bir öğe yok.'}
              </p>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  Filtreleri temizle
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className={cn(
                'grid gap-3',
                selectedItem
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
              )}>
                {items.map((item) => (
                  <CatalogItemCard
                    key={item.id}
                    item={item}
                    lifecycleStages={stages}
                    isSelected={selectedItem?.id === item.id}
                    onSelect={handleCardSelect}
                  />
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    ← Önceki
                  </Button>
                  <span className="text-[12px] text-slate-500">
                    {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Sonraki →
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Side panel */}
        {selectedItem && (
          <CatalogSidePanel
            item={selectedItem}
            lifecycleStages={stages}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </div>
    </div>
  );
}
