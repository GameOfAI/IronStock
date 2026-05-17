/**
 * Lifecycle Lanes page (PR-F5f).
 *
 * Route: /pipeline/lifecycle
 *
 * Shows all visible inventory items grouped horizontally by DevOps lifecycle
 * stage (Plan → Code → Build → Test → Release → Deploy → Operate → Monitor).
 *
 * Items not assigned to any stage appear in an "Atanmamış" section at the bottom.
 * Drag-and-drop a card to a lane → calls POST /items/{id}/lifecycle-stages (additive).
 * The × button on a card removes that specific stage from the item's assignment.
 *
 * Because `useSetItemLifecycleStagesMutation` requires a static itemId at hook
 * instantiation, we mount a hidden "bridge" component per item. Drop/remove
 * handlers post a custom DOM event that the matching bridge picks up and
 * calls the hook-backed mutation.
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Info, Layers, Loader2, RefreshCw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useGraphQuery } from '@/api/graph';
import { useLifecycleStagesQuery, useSetItemLifecycleStagesMutation, lifecycleStagesKey } from '@/api/lifecycle';
import { LifecycleLane, type LaneItem } from '@/components/pipeline/lifecycle-lane';
import { PIPELINE_TYPE_LABELS } from '@/components/pipeline/pipeline-constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLabel(itemTypeId: number, id: string): string {
  return `${PIPELINE_TYPE_LABELS[itemTypeId] ?? 'Öğe'} · ${id.slice(0, 8)}`;
}

const LIFECYCLE_STAGES_EVENT = 'ironstock:set-lifecycle-stages';

interface SetStagesEventDetail {
  itemId: string;
  stageIds: number[];
}

function dispatchSetStages(itemId: string, stageIds: number[]) {
  window.dispatchEvent(
    new CustomEvent<SetStagesEventDetail>(LIFECYCLE_STAGES_EVENT, {
      detail: { itemId, stageIds },
    }),
  );
}

// ---------------------------------------------------------------------------
// Bridge: one per item, listens for the custom event and calls the hook.
// ---------------------------------------------------------------------------

interface BridgeProps {
  itemId: string;
  onSettled: () => void;
  onSuccess: () => void;
}

function LifecycleStageBridge({ itemId, onSettled, onSuccess }: BridgeProps) {
  const mutation = useSetItemLifecycleStagesMutation(itemId);

  React.useEffect(() => {
    function handleEvent(e: Event) {
      const { detail } = e as CustomEvent<SetStagesEventDetail>;
      if (detail.itemId !== itemId) return;
      mutation
        .mutateAsync({ stage_ids: detail.stageIds })
        .then(onSuccess)
        .catch(() => {/* React Query tracks error */})
        .finally(onSettled);
    }
    window.addEventListener(LIFECYCLE_STAGES_EVENT, handleEvent);
    return () => window.removeEventListener(LIFECYCLE_STAGES_EVENT, handleEvent);
    // mutation ref is stable; intentionally omit from deps to avoid re-registering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return null;
}

// ---------------------------------------------------------------------------
// Unassigned item chip (draggable, no color)
// ---------------------------------------------------------------------------

function UnassignedChip({ item }: { item: LaneItem }) {
  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('application/ironstock-item-id', item.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="flex cursor-grab select-none items-center gap-1.5 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40 active:cursor-grabbing"
      title={`ID: ${item.id}`}
    >
      <span className="font-medium text-muted-foreground">{item.displayLabel}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LifecyclePage() {
  const qc = useQueryClient();
  const graphQuery = useGraphQuery();
  const stagesQuery = useLifecycleStagesQuery();
  const [pendingSet, setPendingSet] = React.useState<Set<string>>(new Set());

  const isLoading = graphQuery.isLoading || stagesQuery.isLoading;
  const isError = graphQuery.isError || stagesQuery.isError;

  const stages = React.useMemo(
    () => stagesQuery.data?.stages ?? [],
    [stagesQuery.data],
  );
  const graphNodes = graphQuery.data?.nodes ?? [];

  // lifecycle_stages is the new field we added to GET /api/v1/graph
  const graphData = graphQuery.data as
    | (NonNullable<typeof graphQuery.data> & { lifecycle_stages?: Record<string, number[]> })
    | undefined;
  const lifecycleStagesMap: Record<string, number[]> = graphData?.lifecycle_stages ?? {};

  // Build LaneItem list from graph nodes
  const allItems: LaneItem[] = React.useMemo(
    () =>
      graphNodes.map((node) => ({
        id: node.id,
        itemTypeId: node.item_type_id,
        displayLabel: makeLabel(node.item_type_id, node.id),
        stageIds: lifecycleStagesMap[node.id] ?? [],
      })),
    // graphNodes and lifecycleStagesMap change together when graphQuery.data changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphQuery.data],
  );

  // Items by stage (computed from allItems + stage catalog)
  const itemsByStage = React.useMemo(() => {
    const map: Record<number, LaneItem[]> = {};
    for (const stage of stages) {
      map[stage.id] = allItems.filter((item) => item.stageIds.includes(stage.id));
    }
    return map;
  }, [stages, allItems]);

  // Items with no stage assignment
  const unassignedItems = React.useMemo(
    () => allItems.filter((item) => item.stageIds.length === 0),
    [allItems],
  );

  // --- Mutation success callback (invalidate graph so lanes refresh) ---
  const handleMutationSuccess = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['graph'] });
    void qc.invalidateQueries({ queryKey: lifecycleStagesKey });
  }, [qc]);

  const handleSettled = React.useCallback((itemId: string) => {
    setPendingSet((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  // --- Drop handler: ADD the target stage to the item's current stages ---
  function handleDrop(itemId: string, targetStageId: number) {
    const item = allItems.find((i) => i.id === itemId);
    if (!item) return;
    if (item.stageIds.includes(targetStageId)) return; // already there
    setPendingSet((prev) => new Set(prev).add(itemId));
    dispatchSetStages(itemId, [...item.stageIds, targetStageId]);
  }

  // --- Remove handler: remove a specific stage from the item ---
  function handleRemove(itemId: string, stageId: number) {
    const item = allItems.find((i) => i.id === itemId);
    if (!item) return;
    setPendingSet((prev) => new Set(prev).add(itemId));
    dispatchSetStages(
      itemId,
      item.stageIds.filter((id) => id !== stageId),
    );
  }

  // --- Error state ---
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <p className="text-sm">Veriler yüklenemedi.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void graphQuery.refetch();
            void stagesQuery.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Tekrar dene
        </Button>
      </div>
    );
  }

  // Onboarding banner (dismissible via localStorage)
  const BANNER_KEY = 'ironstock:lifecycle-onboarding-dismissed';
  const [bannerDismissed, setBannerDismissed] = React.useState(
    () => localStorage.getItem(BANNER_KEY) === '1',
  );
  function dismissBanner() {
    localStorage.setItem(BANNER_KEY, '1');
    setBannerDismissed(true);
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Onboarding banner ────────────────────────────────────────── */}
      {!bannerDismissed && !isLoading && (
        <div className="flex items-start gap-3 border-b bg-blue-50 px-6 py-3 dark:bg-blue-950/30">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <p className="flex-1 text-xs text-blue-800 dark:text-blue-300">
            Her öğeyi DevOps yaşam döngüsü aşamalarına <strong>sürükleyip bırakın</strong>.
            Atanmamış öğeler en altta listelenir. Bir öğe birden fazla aşamada olabilir.
            Kartın üzerindeki × butonu ile o aşamadan çıkarabilirsiniz.
          </p>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 text-blue-600 hover:bg-blue-100 dark:text-blue-400 dark:hover:bg-blue-900"
            onClick={dismissBanner}
            title="Kapat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to="/pipeline">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <Layers className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-sm font-semibold">Lifecycle Lanes</h1>
          {!isLoading && (
            <p className="text-[11px] text-muted-foreground">
              {allItems.length} öğe · {stages.length} aşama ·{' '}
              {unassignedItems.length > 0 ? `${unassignedItems.length} atanmamış` : 'tümü atanmış'}
            </p>
          )}
        </div>
        {isLoading && <Loader2 className="ml-1 h-4 w-4 animate-spin text-muted-foreground" />}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-8 w-8"
          title="Yenile"
          onClick={() => {
            void graphQuery.refetch();
            void stagesQuery.refetch();
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* ── Lanes (horizontally scrollable) ───────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-w-max gap-3 p-6">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="w-52 shrink-0 space-y-2">
                  <div className="h-9 animate-pulse rounded-lg bg-muted" />
                  <div className="h-32 animate-pulse rounded-lg bg-muted/50" />
                </div>
              ))
            : stages.map((stage) => (
                <LifecycleLane
                  key={stage.id}
                  stage={stage}
                  items={itemsByStage[stage.id] ?? []}
                  onDrop={(itemId) => handleDrop(itemId, stage.id)}
                  onRemove={(itemId) => handleRemove(itemId, stage.id)}
                  isLoading={pendingSet.size > 0}
                />
              ))}
        </div>

        {/* ── Unassigned section ───────────────────────────────────────── */}
        {!isLoading && unassignedItems.length > 0 && (
          <div className="border-t px-6 pb-6 pt-4">
            <h3 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Layers className="h-3.5 w-3.5" />
              Atanmamış ({unassignedItems.length})
              <span className="font-normal">— sürükleyerek bir aşamaya ekle</span>
            </h3>
            <div className="flex flex-wrap gap-2">
              {unassignedItems.map((item) => (
                <UnassignedChip key={item.id} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Mutation bridges (hidden, one per item) ───────────────────── */}
      {allItems.map((item) => (
        <LifecycleStageBridge
          key={item.id}
          itemId={item.id}
          onSettled={() => handleSettled(item.id)}
          onSuccess={handleMutationSuccess}
        />
      ))}
    </div>
  );
}
