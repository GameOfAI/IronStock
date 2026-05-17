/**
 * Lifecycle Lane — single swimlane column (PR-F5f).
 *
 * Displays a DevOps lifecycle stage header and the item cards assigned to it.
 * Accepts HTML5 native drag-and-drop to reassign items to this stage.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS } from './pipeline-constants';
import type { LifecycleStage } from '@/api/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaneItem {
  id: string;
  itemTypeId: number;
  /** Encrypted — client can't decrypt without DEK. We show type label + id slice. */
  displayLabel: string;
  stageIds: number[];
}

interface LifecycleLaneProps {
  stage: LifecycleStage;
  items: LaneItem[];
  /** Called when an item is dropped onto this lane. Receives the item_id. */
  onDrop: (itemId: string) => void;
  /** Called when the remove (×) button is clicked on an item card. */
  onRemove: (itemId: string) => void;
  /** Disable drop target while a mutation is pending. */
  isLoading?: boolean;
}

// ---------------------------------------------------------------------------
// Item card inside a lane
// ---------------------------------------------------------------------------

interface LaneItemCardProps {
  item: LaneItem;
  stageColor: string;
  onRemove: (id: string) => void;
}

function LaneItemCard({ item, stageColor, onRemove }: LaneItemCardProps) {
  const Icon = PIPELINE_TYPE_ICONS[item.itemTypeId] ?? PIPELINE_TYPE_ICONS[6];
  const typeLabel = PIPELINE_TYPE_LABELS[item.itemTypeId] ?? 'Öğe';

  function handleDragStart(e: React.DragEvent<HTMLDivElement>) {
    e.dataTransfer.setData('application/ironstock-item-id', item.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className="group relative flex items-start gap-2 rounded-md border bg-card p-2.5 shadow-sm cursor-grab active:cursor-grabbing select-none hover:border-primary/40 transition-colors"
    >
      {/* Top color accent line */}
      <div
        className="absolute inset-x-0 top-0 h-[3px] rounded-t-md"
        style={{ backgroundColor: stageColor }}
      />

      {/* Icon */}
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm"
        style={{ backgroundColor: `${stageColor}22` }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: stageColor }} />
      </div>

      {/* Label */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium leading-tight">{item.displayLabel}</p>
        <Badge variant="outline" className="mt-0.5 h-4 px-1 text-[9px]">
          {typeLabel}
        </Badge>
      </div>

      {/* Remove button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onRemove(item.id)}
        title="Bu aşamadan çıkar"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lane
// ---------------------------------------------------------------------------

export function LifecycleLane({
  stage,
  items,
  onDrop,
  onRemove,
  isLoading = false,
}: LifecycleLaneProps) {
  const [isDragOver, setIsDragOver] = React.useState(false);

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    // Only clear if leaving the lane element itself (not a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragOver(false);
    const itemId = e.dataTransfer.getData('application/ironstock-item-id');
    if (itemId) {
      onDrop(itemId);
    }
  }

  return (
    <div className="flex w-52 shrink-0 flex-col gap-2">
      {/* Lane header */}
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{ backgroundColor: `${stage.color}18` }}
      >
        <div
          className="h-2 w-2 rounded-full shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <span className="truncate text-xs font-semibold" style={{ color: stage.color }}>
          {stage.label}
        </span>
        <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {items.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          'flex min-h-32 flex-col gap-2 rounded-lg border-2 border-dashed p-2 transition-colors',
          isDragOver && !isLoading
            ? 'border-primary bg-primary/5'
            : 'border-border/50 bg-muted/20',
          isLoading && 'pointer-events-none opacity-60',
        )}
      >
        {items.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-center text-[11px] text-muted-foreground/60 select-none">
              {isDragOver ? 'Bırak' : 'Öğe yok'}
            </p>
          </div>
        )}
        {items.map((item) => (
          <LaneItemCard
            key={item.id}
            item={item}
            stageColor={stage.color}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}
