/**
 * PipelineEdge — custom animated edge for the pipeline diagram (PR-F5e).
 *
 * Renders a bezier curve with:
 *  - Animated dashes (shows data-flow direction)
 *  - Relationship type label centered on the edge
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { RelationshipType } from '@/api/types';
import { REL_LABELS } from './pipeline-constants';

export interface PipelineEdgeData {
  relType: RelationshipType;
  [key: string]: unknown;
}

export function PipelineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const d = data as PipelineEdgeData | undefined;
  const relLabel = d?.relType ? (REL_LABELS[d.relType] ?? d.relType) : '';

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected
            ? 'hsl(var(--primary))'
            : 'hsl(var(--muted-foreground))',
          strokeWidth: selected ? 2 : 1.5,
          strokeDasharray: '6 3',
          animation: 'dashdraw 0.5s linear infinite',
        }}
      />

      {relLabel && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-none absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span className="rounded-sm border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
              {relLabel}
            </span>
          </div>
        </EdgeLabelRenderer>
      )}

      {/* Inline keyframes for dash animation — injected once per edge render.
          ReactFlow doesn't remove duplicates but browsers de-dup identical @keyframes. */}
      <style>{`
        @keyframes dashdraw {
          from { stroke-dashoffset: 18; }
          to   { stroke-dashoffset: 0; }
        }
      `}</style>
    </>
  );
}
