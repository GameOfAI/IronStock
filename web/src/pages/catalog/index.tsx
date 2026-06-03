/**
 * CatalogPage — Backstage-style entity discovery browser (PR-DP04).
 *
 * Route: /catalog
 * Left panel: kind + owner filters (client-side; kind backend filter added in PR-DP05).
 * Content: entity cards in a responsive grid.
 */

import * as React from 'react';
import { Search, LayoutGrid, List, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useItemTypes } from '@/api/catalog';
import { useCatalogQuery } from '@/api/catalog-browser';
import { EntityCard } from '@/components/catalog/entity-card';
import type { Item } from '@/api/types';
import { useNavigate } from 'react-router-dom';

type ViewMode = 'grid' | 'list';

export default function CatalogPage() {
  const [q, setQ] = React.useState('');
  const [selectedKind, setSelectedKind] = React.useState<string | null>(null);
  const [view, setView] = React.useState<ViewMode>('grid');
  const navigate = useNavigate();

  const { data: typesData } = useItemTypes();
  const kinds = React.useMemo(
    () =>
      (typesData?.item_types ?? [])
        .filter((t) => t.kind_key)
        .map((t) => t.kind_key as string),
    [typesData],
  );

  const { data, isLoading, isFetching } = useCatalogQuery({
    q,
    kind: selectedKind,
  });

  const items = data?.items ?? [];

  function handleItemClick(item: Item) {
    if (item.kind && item.name) {
      const encodedName = encodeURIComponent(item.name);
      navigate(`/catalog/${item.kind}/default/${encodedName}`);
    } else {
      navigate(`/inventory?item=${item.id}`);
    }
  }

  const showEmptySearch = q.trim().length < 2;
  const showNoResults = !showEmptySearch && !isLoading && items.length === 0;

  return (
    <div className="flex h-full min-h-0">
      {/* Left filter panel */}
      <aside className="hidden w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-800 bg-slate-950 p-4 lg:flex">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Kind
          </p>
          <button
            type="button"
            onClick={() => setSelectedKind(null)}
            className={cn(
              'mb-1 flex w-full items-center rounded px-2 py-1.5 text-left text-[12px] transition-colors',
              selectedKind === null
                ? 'bg-slate-800 text-slate-100'
                : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
            )}
          >
            Tümü
          </button>
          {kinds.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setSelectedKind(kind === selectedKind ? null : kind)}
              className={cn(
                'flex w-full items-center rounded px-2 py-1.5 text-left font-mono text-[11px] uppercase tracking-wide transition-colors',
                selectedKind === kind
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200',
              )}
            >
              {kind}
            </button>
          ))}
        </div>
      </aside>

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-950 px-4 py-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Entity ara… (en az 2 karakter)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-8 w-full rounded-md border border-slate-700 bg-slate-900 pl-8 pr-8 text-[13px] text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Mobile kind filter chips */}
          {selectedKind && (
            <button
              type="button"
              onClick={() => setSelectedKind(null)}
              className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-mono uppercase text-slate-300 lg:hidden"
            >
              {selectedKind}
              <X className="h-3 w-3" />
            </button>
          )}

          <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-slate-700 bg-slate-900 p-0.5">
            <button
              type="button"
              onClick={() => setView('grid')}
              className={cn(
                'rounded p-1.5 transition-colors',
                view === 'grid'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300',
              )}
              title="Kart görünümü"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setView('list')}
              className={cn(
                'rounded p-1.5 transition-colors',
                view === 'list'
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-500 hover:text-slate-300',
              )}
              title="Liste görünümü"
            >
              <List className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {showEmptySearch && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Search className="mb-4 h-10 w-10 text-slate-700" />
              <p className="text-[14px] font-medium text-slate-400">Entity kataloğunu keşfet</p>
              <p className="mt-1 text-[12px] text-slate-600">
                Arama çubuğuna en az 2 karakter girerek entity'leri bul.
              </p>
              {kinds.length > 0 && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {kinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => {
                        setSelectedKind(kind);
                        setQ(kind.toLowerCase().slice(0, 3));
                      }}
                      className="rounded border border-slate-700 bg-slate-800/60 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-slate-400 hover:border-slate-600 hover:text-slate-200"
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isLoading && isFetching && !showEmptySearch && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 animate-pulse rounded-lg border border-slate-800 bg-slate-900/40"
                />
              ))}
            </div>
          )}

          {showNoResults && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-[14px] font-medium text-slate-400">Sonuç bulunamadı</p>
              <p className="mt-1 text-[12px] text-slate-600">
                &ldquo;{q}&rdquo; için eşleşen entity yok.
              </p>
            </div>
          )}

          {!showEmptySearch && items.length > 0 && view === 'grid' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <EntityCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
              ))}
            </div>
          )}

          {!showEmptySearch && items.length > 0 && view === 'list' && (
            <div className="flex flex-col gap-1.5">
              {items.map((item) => (
                <EntityCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
