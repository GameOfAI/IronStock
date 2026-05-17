/**
 * PipelineCanvas — ReactFlow canvas for a single pipeline diagram (PR-F5e/g).
 *
 * Features:
 *  - Renders DiagramGraphResponse as ReactFlow nodes + edges
 *  - Dagre LR auto-layout (triggered by toolbar button or on first load when
 *    all positions are null)
 *  - Node drag-stop saves layout (debounced 1 s)
 *  - Custom node (PipelineNode) and edge (PipelineEdge) types
 *  - Controls panel: Auto Layout, Fit View, Save, Export PNG/SVG
 *  - ReactFlow Background + Controls + MiniMap
 */

import * as React from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodeDrag,
  BackgroundVariant,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { toPng, toSvg } from 'html-to-image';
import '@xyflow/react/dist/style.css';

import { PipelineNode, type PipelineNodeData } from './pipeline-node';
import { PipelineEdge } from './pipeline-edge';
import type { DiagramGraphResponse, LifecycleStage } from '@/api/types';
import { useSaveDiagramLayoutMutation, useRemoveDiagramNodeMutation } from '@/api/pipeline';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Maximize2, Save, ImageDown } from 'lucide-react';

// --- Dagre layout ─────────────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: 'LR' | 'TB' = 'LR',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 100, nodesep: 50, marginx: 30, marginy: 30 });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return {
    nodes: nodes.map((n) => {
      const pos = g.node(n.id);
      return { ...n, position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 } };
    }),
    edges,
  };
}

// --- Build ReactFlow elements from API response ────────────────────────────────

function buildElements(
  graphData: DiagramGraphResponse,
  lifecycleCatalog: LifecycleStage[],
  onRemove?: (nodeId: string) => void,
): { nodes: Node[]; edges: Edge[]; needsLayout: boolean } {
  // Map stage id → stage
  const stageById = new Map(lifecycleCatalog.map((s) => [s.id, s]));

  let needsLayout = false;

  const nodes: Node[] = graphData.nodes.map((gn) => {
    const stageIds: number[] = graphData.lifecycle_stages[gn.id] ?? [];
    const firstStage = stageIds.length > 0 ? stageById.get(stageIds[0]) : undefined;

    const hasPosition =
      gn.position_x != null && gn.position_y != null;

    if (!hasPosition) needsLayout = true;

    const label =
      gn.custom_label ??
      `${gn.item_type_id ? `#${gn.item_type_id}` : 'Öğe'} · ${gn.id.slice(0, 8)}`;

    const data: PipelineNodeData = {
      itemTypeId: gn.item_type_id,
      label,
      stageColor: firstStage?.color,
      stageLabel: firstStage?.label,
      onRemove,
    };

    return {
      id: gn.id,
      type: 'pipelineNode',
      position: hasPosition
        ? { x: gn.position_x!, y: gn.position_y! }
        : { x: 0, y: 0 },
      data,
    } satisfies Node;
  });

  const edges: Edge[] = graphData.edges.map((ge) => ({
    id: `${ge.source_id}-${ge.target_id}-${ge.type}`,
    source: ge.source_id,
    target: ge.target_id,
    type: 'pipelineEdge',
    data: { relType: ge.type },
    animated: false,
  }));

  return { nodes, edges, needsLayout };
}

// --- Custom node / edge types (defined outside component to stay stable) ───────

const NODE_TYPES = { pipelineNode: PipelineNode };
const EDGE_TYPES = { pipelineEdge: PipelineEdge };

// --- Inner canvas (needs useReactFlow — must be inside ReactFlowProvider) ──────

const EXPORT_PADDING = 40; // px padding around nodes in exported image

interface CanvasInnerProps {
  diagramId: string;
  graphData: DiagramGraphResponse;
  lifecycleCatalog: LifecycleStage[];
  diagramName?: string;
}

function CanvasInner({ diagramId, graphData, lifecycleCatalog, diagramName }: CanvasInnerProps) {
  const { fitView, getViewport } = useReactFlow();
  const saveLayout = useSaveDiagramLayoutMutation(diagramId);
  const removeNode = useRemoveDiagramNodeMutation(diagramId);

  const handleRemoveNode = React.useCallback(
    (nodeId: string) => {
      removeNode.mutate(nodeId);
    },
    [removeNode],
  );

  // Build initial nodes/edges from graph data
  const { nodes: initialNodes, edges: initialEdges, needsLayout: initialNeedsLayout } =
    React.useMemo(
      () => buildElements(graphData, lifecycleCatalog, handleRemoveNode),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [graphData, lifecycleCatalog],
    );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-sync when graphData changes (e.g. after adding/removing nodes)
  React.useEffect(() => {
    const { nodes: newNodes, edges: newEdges, needsLayout } = buildElements(
      graphData,
      lifecycleCatalog,
      handleRemoveNode,
    );
    if (needsLayout) {
      const { nodes: laid, edges: laidEdges } = applyDagreLayout(newNodes, newEdges);
      setNodes(laid);
      setEdges(laidEdges);
    } else {
      setNodes(newNodes);
      setEdges(newEdges);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData]);

  // Apply dagre layout on first load if positions are missing
  React.useEffect(() => {
    if (initialNeedsLayout && nodes.length > 0) {
      const { nodes: laid } = applyDagreLayout(nodes, edges);
      setNodes(laid);
      setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    }
    // run once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced save layout
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function scheduleSave(currentNodes: Node[]) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const viewport = getViewport();
      saveLayout.mutate({
        nodes: currentNodes.map((n) => ({
          item_id: n.id,
          position_x: n.position.x,
          position_y: n.position.y,
        })),
        viewport,
      });
    }, 1000);
  }

  const handleNodeDragStop: OnNodeDrag = (_event, _node, allNodes) => {
    scheduleSave(allNodes);
  };

  // Allow new edges to be drawn on canvas (connects existing handles)
  const handleConnect: OnConnect = React.useCallback(
    (connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  // Toolbar handlers
  function handleAutoLayout() {
    const { nodes: laid, edges: laidEdges } = applyDagreLayout(nodes, edges);
    setNodes(laid);
    setEdges(laidEdges);
    setTimeout(() => fitView({ padding: 0.15, duration: 400 }), 50);
    scheduleSave(laid);
  }

  function handleFitView() {
    fitView({ padding: 0.15, duration: 400 });
  }

  function handleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const viewport = getViewport();
    saveLayout.mutate({
      nodes: nodes.map((n) => ({
        item_id: n.id,
        position_x: n.position.x,
        position_y: n.position.y,
      })),
      viewport,
    });
  }

  // Export helpers — use html-to-image on the ReactFlow viewport element
  function getFlowViewport() {
    return document.querySelector<HTMLElement>('.react-flow__viewport');
  }

  function buildExportTransform() {
    if (nodes.length === 0) return null;
    const bounds = getNodesBounds(nodes);
    const imgWidth = bounds.width + EXPORT_PADDING * 2;
    const imgHeight = bounds.height + EXPORT_PADDING * 2;
    const vp = getViewportForBounds(bounds, imgWidth, imgHeight, 0.5, 2, EXPORT_PADDING);
    return { imgWidth, imgHeight, vp };
  }

  function handleExportPng() {
    const el = getFlowViewport();
    const t = buildExportTransform();
    if (!el || !t) return;
    const { imgWidth, imgHeight, vp } = t;
    void toPng(el, {
      width: imgWidth,
      height: imgHeight,
      style: { transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${diagramName ?? 'pipeline'}.png`;
      a.click();
    });
  }

  function handleExportSvg() {
    const el = getFlowViewport();
    const t = buildExportTransform();
    if (!el || !t) return;
    const { imgWidth, imgHeight, vp } = t;
    void toSvg(el, {
      width: imgWidth,
      height: imgHeight,
      style: { transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    }).then((dataUrl) => {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${diagramName ?? 'pipeline'}.svg`;
      a.click();
    });
  }

  if (nodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed bg-muted/10 text-sm text-muted-foreground">
        <div className="flex flex-col items-center gap-2 text-center">
          <LayoutDashboard className="h-10 w-10 opacity-20" />
          <p className="font-medium">Henüz öğe yok</p>
          <p className="text-xs">Sol panelden diyagrama öğe ekleyin.</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={handleConnect}
      onNodeDragStop={handleNodeDragStop}
      nodeTypes={NODE_TYPES}
      edgeTypes={EDGE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        nodeStrokeWidth={2}
        pannable
        zoomable
        className="!bg-background !border !border-border rounded-lg"
      />

      {/* Toolbar panel */}
      <Panel position="top-right" className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background shadow-sm"
          onClick={handleAutoLayout}
          title="Dagre LR otomatik yerleşim"
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Otomatik Yerleşim</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background shadow-sm"
          onClick={handleFitView}
          title="Tüm öğeleri ekrana sığdır"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Sığdır</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background shadow-sm"
          onClick={handleSave}
          disabled={saveLayout.isPending}
          title="Yerleşimi kaydet"
        >
          <Save className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">
            {saveLayout.isPending ? 'Kaydediliyor…' : 'Kaydet'}
          </span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background shadow-sm"
          onClick={handleExportPng}
          title="PNG olarak indir"
        >
          <ImageDown className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">PNG</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 bg-background shadow-sm"
          onClick={handleExportSvg}
          title="SVG olarak indir"
        >
          <ImageDown className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">SVG</span>
        </Button>
      </Panel>
    </ReactFlow>
  );
}

// --- Public component (wraps with ReactFlowProvider) ──────────────────────────

export interface PipelineCanvasProps {
  diagramId: string;
  graphData: DiagramGraphResponse;
  lifecycleCatalog: LifecycleStage[];
  /** Used as the filename for PNG/SVG exports */
  diagramName?: string;
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
