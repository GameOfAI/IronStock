/**
 * DiagramSidebar — item picker for the pipeline diagram canvas (PR-F5e).
 *
 * Shows all graph nodes visible to the current user that are NOT yet in the
 * diagram. The user can search by item type label or short ID, then click
 * "Ekle" to add items to the canvas.
 *
 * Names are server-encrypted in the graph response, so we display:
 *   PIPELINE_TYPE_LABELS[item_type_id] · id.slice(0, 8)
 */

import * as React from 'react';
import { Plus, Loader2, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useGraphQuery } from '@/api/graph';
import { useAddDiagramNodesMutation } from '@/api/pipeline';
import { PIPELINE_TYPE_LABELS, PIPELINE_TYPE_ICONS } from './pipeline-node';
import { cn } from '@/lib/cn';

interface DiagramSidebarProps {
  diagramId: string;
  /** IDs of items already in the diagram — these are hidden from the picker. */
  existingItemIds: Set<string>;
}

export function DiagramSidebar({ diagramId, existingItemIds }: DiagramSidebarProps) {
  const [search, setSearch] = React.useState('');
  const [adding, setAdding] = React.useState<Set<string>>(new Set());

  const { data: graphData, isLoading } = useGraphQuery();
  const addNodes = useAddDiagramNodesMutation(diagramId);

  // All graph nodes not yet in this diagram
  const candidates = React.useMemo(() => {
    const all = graphData?.nodes ?? [];
    return all.filter((n) => !existingItemIds.has(n.id));
  }, [graphData?.nodes, existingItemIds]);

  // Filter by search (type label or ID)
  const filtered = React.useMemo(() => {
    if (!search.trim()) return candidates;
    const q = search.toLowerCase();
    return candidates.filter((n) => {
      const typeLabel = (PIPELINE_TYPE_LABELS[n.item_type_id] ?? '').toLowerCase();
      return typeLabel.includes(q) || n.id.toLowerCase().includes(q);
    });
  }, [candidates, search]);

  async function handleAdd(itemId: string) {
    setAdding((prev) => new Set(prev).add(itemId));
    try {
      await addNodes.mutateAsync({ item_ids: [itemId] });
    } finally {
      setAdding((prev) => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-background">
      {/* Header */}
      <div className="border-b px-3 py-2.5">
        <p className="text-sm font-semibold">Öğe Ekle</p>
        <p className="text-[10px] text-muted-foreground">
          {candidates.length} öğe mevcut
        </p>
      </div>

      {/* Search */}
      <div className="px-2 py-2">
        <Input
          placeholder="Tip veya ID ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-sm"
        />
      </div>

      {/* Item list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-1 py-8 text-center text-xs text-muted-foreground">
            <Box className="h-6 w-6 opacity-30" />
            {candidates.length === 0
              ? 'Tüm öğeler diyagramda.'
              : 'Arama sonucu yok.'}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5 px-2 pb-2">
            {filtered.map((node) => {
              const Icon = PIPELINE_TYPE_ICONS[node.item_type_id] ?? Box;
              const typeLabel = PIPELINE_TYPE_LABELS[node.item_type_id] ?? 'Öğe';
              const isAdding = adding.has(node.id);

              return (
                <li
                  key={node.id}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2 py-2 transition-colors',
                    'hover:bg-accent',
                  )}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">{typeLabel}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {node.id.slice(0, 12)}…
                    </p>
                  </div>

                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    disabled={isAdding}
                    onClick={() => handleAdd(node.id)}
                    aria-label={`${typeLabel} ekle`}
                  >
                    {isAdding ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add all filtered / multiple select hint */}
      {filtered.length > 1 && (
        <div className="border-t px-2 py-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1.5 text-xs"
            disabled={addNodes.isPending}
            onClick={() => {
              const ids = filtered.map((n) => n.id);
              addNodes.mutate({ item_ids: ids });
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Tümünü ekle ({filtered.length})
          </Button>
        </div>
      )}
    </aside>
  );
}

// --- Compact "stage badge" for type color coding ─────────────────────────────

interface TypeBadgeProps {
  itemTypeId: number;
  className?: string;
}

export function TypeBadge({ itemTypeId, className }: TypeBadgeProps) {
  const label = PIPELINE_TYPE_LABELS[itemTypeId] ?? 'Öğe';
  return (
    <Badge variant="outline" className={cn('text-[10px]', className)}>
      {label}
    </Badge>
  );
}
