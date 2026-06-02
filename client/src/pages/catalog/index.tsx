import * as React from 'react';
import { Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useItemTypes } from '@/api/catalog';
import { useCatalogQuery } from '@/api/catalog-browser';
import type { Item } from '@/api/types';
import { EntityCard } from './entity-card';

export default function CatalogPage() {
  const [q, setQ] = React.useState('');
  const [selectedKind, setSelectedKind] = React.useState<string | null>(null);
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
      navigate(`/catalog/${item.kind}/default/${encodeURIComponent(item.name)}`);
    } else {
      navigate(`/inventory?item=${item.id}`);
    }
  }

  const showEmptySearch = q.trim().length < 2;
  const showNoResults = !showEmptySearch && !isLoading && items.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Entity ara… (en az 2 karakter)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-full rounded-md border bg-background pl-8 pr-8 text-[13px] placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Kind filter chips */}
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setSelectedKind(null)}
            className={cn(
              'shrink-0 rounded px-2 py-1 text-[11px] font-medium transition-colors',
              selectedKind === null
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground',
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
                'shrink-0 rounded px-2 py-1 font-mono text-[10px] uppercase tracking-wide transition-colors',
                selectedKind === kind
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground',
              )}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {showEmptySearch && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-4 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">Entity kataloğunu keşfet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
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
                    className="rounded border bg-muted px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {kind}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isLoading && isFetching && !showEmptySearch && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-lg border bg-muted/40"
              />
            ))}
          </div>
        )}

        {showNoResults && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm font-medium text-muted-foreground">Sonuç bulunamadı</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              &ldquo;{q}&rdquo; için eşleşen entity yok.
            </p>
          </div>
        )}

        {!showEmptySearch && items.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((item) => (
              <EntityCard key={item.id} item={item} onClick={() => handleItemClick(item)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
