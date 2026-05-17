/**
 * PipelineNode — custom ReactFlow node for pipeline diagram canvas (PR-F5e).
 *
 * Renders an item card with:
 *  - Lifecycle stage color bar at top (if assigned)
 *  - Item type icon + display label
 *  - Source (right) and Target (left) connection handles
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS } from './pipeline-constants';

export { PIPELINE_TYPE_ICONS, PIPELINE_TYPE_LABELS };

// --- Node data shape ---

export interface PipelineNodeData {
  itemTypeId: number;
  /** Display label — custom_label or fallback to type+id */
  label: string;
  /** Primary lifecycle stage hex color (first assigned stage) */
  stageColor?: string;
  /** Primary lifecycle stage label */
  stageLabel?: string;
  /** Callback to remove this node from the diagram */
  onRemove?: (nodeId: string) => void;
  [key: string]: unknown;
}

// --- Component ---

export function PipelineNode({ data, selected, id }: NodeProps) {
  const d = data as PipelineNodeData;
  const Icon = PIPELINE_TYPE_ICONS[d.itemTypeId] ?? Box;
  const typeLabel = PIPELINE_TYPE_LABELS[d.itemTypeId] ?? 'Öğe';

  return (
    <div
      className={cn(
        'group/node relative rounded-lg border-2 bg-card shadow-sm transition-all min-w-[160px] max-w-[220px]',
        selected
          ? 'border-primary shadow-md ring-2 ring-primary/20'
          : 'border-border hover:border-primary/40',
      )}
    >
      {/* Remove button — visible on hover or selected */}
      {d.onRemove && (
        <button
          className={cn(
            'absolute -right-2 -top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full',
            'bg-destructive text-destructive-foreground shadow-sm',
            'opacity-0 transition-opacity hover:bg-destructive/90',
            'group-hover/node:opacity-100',
            selected && 'opacity-100',
          )}
          onClick={(e) => {
            e.stopPropagation();
            d.onRemove!(id);
          }}
          title="Diyagramdan kaldır"
        >
          <X className="h-3 w-3" />
        </button>
      )}

      {/* Lifecycle stage color bar */}
      {d.stageColor && (
        <div
          className="h-1 rounded-t-[6px]"
          style={{ backgroundColor: d.stageColor }}
        />
      )}

      <div className="p-3">
        {/* Icon + label row */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{d.label}</p>
            <p className="text-[10px] text-muted-foreground">{typeLabel}</p>
          </div>
        </div>

        {/* Stage badge */}
        {d.stageLabel && (
          <div className="mt-1.5 flex items-center gap-1">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: d.stageColor }}
            />
            <span className="text-[10px] text-muted-foreground">{d.stageLabel}</span>
          </div>
        )}
      </div>

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-background !bg-muted-foreground"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-background !bg-primary"
      />
    </div>
  );
}
