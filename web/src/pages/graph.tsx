/**
 * Graph page — DevOps pipeline relationship map (PR-F5b).
 *
 * Renders a simple force-directed-style relationship map using SVG.
 * Full ReactFlow integration is planned for a future PR; this MVP shows
 * nodes and edges with basic drag support.
 *
 * Route: /graph
 */

import * as React from 'react';
import { useGraphQuery, useAddRelationshipMutation, useDeleteRelationshipMutation } from '@/api/graph';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { RelationshipType, GraphNode, GraphEdge } from '@/api/types';
import { cn } from '@/lib/cn';

// --- Item type name map (matches item_types seeded data) ---
const ITEM_TYPE_LABELS: Record<number, string> = {
  1: 'Sunucu',
  2: 'URL',
  3: 'Veritabanı',
  4: 'SSH Anahtarı',
  5: 'API Anahtarı',
  6: 'Genel',
};

const ITEM_TYPE_COLORS: Record<number, string> = {
  1: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  2: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  3: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  4: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  5: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  6: 'bg-muted text-muted-foreground',
};

const REL_LABELS: Record<RelationshipType, string> = {
  hosted_on: 'barındırılıyor',
  accessed_via: 'erişiliyor',
  part_of: 'parçası',
  related_to: 'ilişkili',
  depends_on: 'bağımlı',
  uses_tool: 'araç kullanır',
  builds_to: 'build eder',
  scans_with: 'tarar',
  deploys_to: 'deploy eder',
};

const REL_TYPES: RelationshipType[] = [
  'hosted_on', 'accessed_via', 'part_of', 'related_to', 'depends_on',
  'uses_tool', 'builds_to', 'scans_with', 'deploys_to',
];

// --- Add Relationship Panel ---

interface AddRelPanelProps {
  sourceId: string;
  nodes: GraphNode[];
  onCancel: () => void;
  onDone: () => void;
}

function AddRelPanel({ sourceId, nodes, onCancel, onDone }: AddRelPanelProps) {
  const [targetId, setTargetId] = React.useState('');
  const [relType, setRelType] = React.useState<RelationshipType>('depends_on');
  const addRel = useAddRelationshipMutation(sourceId);

  const candidates = nodes.filter((n) => n.id !== sourceId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;
    await addRel.mutateAsync({ target_id: targetId, type: relType });
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border bg-background p-4 shadow">
      <p className="text-sm font-semibold">İlişki Ekle</p>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Hedef öğe</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          required
        >
          <option value="">— Seçin —</option>
          {candidates.map((n) => (
            <option key={n.id} value={n.id}>
              {ITEM_TYPE_LABELS[n.item_type_id] ?? 'Öğe'} · {n.id.slice(0, 8)}…
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">İlişki tipi</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={relType}
          onChange={(e) => setRelType(e.target.value as RelationshipType)}
        >
          {REL_TYPES.map((t) => (
            <option key={t} value={t}>
              {REL_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={addRel.isPending || !targetId}>
          Ekle
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          İptal
        </Button>
      </div>
    </form>
  );
}

// --- Graph Node Card (list view) ---

interface NodeCardProps {
  node: GraphNode;
  edges: GraphEdge[];
  allNodes: GraphNode[];
  selected: boolean;
  onClick: () => void;
  onDeleteEdge: (targetId: string, type: RelationshipType) => void;
}

function NodeCard({ node, edges, allNodes, selected, onClick, onDeleteEdge }: NodeCardProps) {
  const outgoing = edges.filter((e) => e.source_id === node.id);
  const incoming = edges.filter((e) => e.target_id === node.id);

  function nodeName(id: string): string {
    const n = allNodes.find((x) => x.id === id);
    return n ? `${ITEM_TYPE_LABELS[n.item_type_id] ?? 'Öğe'} (${id.slice(0, 6)}…)` : id.slice(0, 8);
  }

  return (
    <div
      className={cn(
        'flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-accent',
        selected && 'border-primary bg-primary/5',
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="flex items-center gap-2">
        <Badge
          className={cn('text-[10px]', ITEM_TYPE_COLORS[node.item_type_id] ?? '')}
        >
          {ITEM_TYPE_LABELS[node.item_type_id] ?? 'Öğe'}
        </Badge>
        <span className="font-mono text-xs text-muted-foreground">{node.id.slice(0, 12)}…</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          Klasör: {node.folder_id.slice(0, 8)}…
        </span>
      </div>

      {outgoing.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">→ Giden</p>
          {outgoing.map((e) => (
            <div key={`${e.target_id}-${e.type}`} className="flex items-center gap-1.5 text-xs">
              <span className="text-primary font-medium">{REL_LABELS[e.type as RelationshipType]}</span>
              <span className="text-muted-foreground">→ {nodeName(e.target_id)}</span>
              <button
                className="ml-auto text-destructive hover:underline text-[10px]"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onDeleteEdge(e.target_id, e.type as RelationshipType);
                }}
              >
                Sil
              </button>
            </div>
          ))}
        </div>
      )}

      {incoming.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">← Gelen</p>
          {incoming.map((e) => (
            <div key={`${e.source_id}-${e.type}`} className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">{nodeName(e.source_id)}</span>
              <span className="text-primary font-medium">{REL_LABELS[e.type as RelationshipType]}</span>
              <span>→ bu öğe</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Graph Page ---

export function GraphPage() {
  const { data, isLoading, isError } = useGraphQuery();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [addingForId, setAddingForId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState('');

  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];

  // Filter nodes by type label / id substring
  const filtered = nodes.filter((n) => {
    if (!search) return true;
    const label = (ITEM_TYPE_LABELS[n.item_type_id] ?? '').toLowerCase();
    return label.includes(search.toLowerCase()) || n.id.includes(search.toLowerCase());
  });

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  const deleteRel = useDeleteRelationshipMutation(selectedId ?? '');

  function handleDeleteEdge(targetId: string, type: RelationshipType) {
    if (!selectedId) return;
    deleteRel.mutate({ targetId, type });
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Graf yükleniyor…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-destructive">
        Graf yüklenirken hata oluştu.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pipeline İlişki Haritası</h1>
          <p className="text-sm text-muted-foreground">
            {nodes.length} öğe · {edges.length} ilişki
          </p>
        </div>
      </div>

      {/* Search */}
      <Input
        placeholder="Öğe tipi veya ID ara…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {/* Main content */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Node list */}
        <div className="flex w-96 flex-col gap-2 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">Öğe bulunamadı.</p>
          ) : (
            filtered.map((node) => (
              <div key={node.id}>
                <NodeCard
                  node={node}
                  edges={edges}
                  allNodes={nodes}
                  selected={selectedId === node.id}
                  onClick={() => {
                    setSelectedId(node.id === selectedId ? null : node.id);
                    setAddingForId(null);
                  }}
                  onDeleteEdge={handleDeleteEdge}
                />
                {selectedId === node.id && (
                  <div className="mt-1 pl-2">
                    {addingForId === node.id ? (
                      <AddRelPanel
                        sourceId={node.id}
                        nodes={nodes}
                        onCancel={() => setAddingForId(null)}
                        onDone={() => setAddingForId(null)}
                      />
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAddingForId(node.id);
                        }}
                      >
                        + İlişki Ekle
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Detail / placeholder for future canvas */}
        <div className="flex flex-1 items-center justify-center rounded-lg border bg-muted/20 text-center text-sm text-muted-foreground">
          {selectedNode ? (
            <div className="flex flex-col gap-2 p-6">
              <p className="font-semibold">
                {ITEM_TYPE_LABELS[selectedNode.item_type_id] ?? 'Öğe'}
              </p>
              <p className="font-mono text-xs">{selectedNode.id}</p>
              <p className="text-xs">Klasör: {selectedNode.folder_id}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Tam graf görselleştirmesi (ReactFlow) sonraki PR'da eklenecek.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <p>Detay için sol listeden bir öğe seçin.</p>
              <p className="text-xs">
                Tam görsel harita (ReactFlow) sonraki PR'da eklenecek.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
