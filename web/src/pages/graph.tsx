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
  7: 'Not',
  8: 'Diğer',
};

const ITEM_TYPE_COLORS: Record<number, string> = {
  1: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  2: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  3: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  4: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  5: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  6: 'bg-muted text-muted-foreground',
  7: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  8: 'bg-muted text-muted-foreground',
};

const REL_LABELS: Record<RelationshipType, string> = {
  hosted_on: 'barındırılıyor (hosted_on)',
  accessed_via: 'erişiliyor (accessed_via)',
  part_of: 'parçası (part_of)',
  related_to: 'ilişkili (related_to)',
  depends_on: 'bağımlı (depends_on)',
  uses_tool: 'araç kullanır (uses_tool)',
  builds_to: 'build eder (builds_to)',
  scans_with: 'tarar (scans_with)',
  deploys_to: 'deploy eder (deploys_to)',
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
              {n.name} ({ITEM_TYPE_LABELS[n.item_type_id] ?? 'Öğe'})
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
    return n?.name || id.slice(0, 8);
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
        <span className="text-sm font-medium">{node.name}</span>
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
  const [activeTypes, setActiveTypes] = React.useState<Set<number>>(new Set());

  const nodes = React.useMemo(() => data?.nodes ?? [], [data]);
  const edges = React.useMemo(() => data?.edges ?? [], [data]);

  // Unique item type IDs present in graph
  const presentTypes = React.useMemo(
    () => [...new Set(nodes.map((n) => n.item_type_id))].sort(),
    [nodes],
  );

  function toggleType(typeId: number) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeId)) next.delete(typeId);
      else next.add(typeId);
      return next;
    });
  }

  // Filter nodes by search text + active type chips
  const filtered = nodes.filter((n) => {
    // Type filter (empty = show all)
    if (activeTypes.size > 0 && !activeTypes.has(n.item_type_id)) return false;
    // Text search
    if (!search) return true;
    const q = search.toLowerCase();
    const label = (ITEM_TYPE_LABELS[n.item_type_id] ?? '').toLowerCase();
    return (
      n.name.toLowerCase().includes(q) ||
      label.includes(q) ||
      n.id.includes(q)
    );
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

      {/* Search + type filters */}
      <div className="flex flex-col gap-2">
        <Input
          placeholder="Ad, tip veya ID ara…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        {presentTypes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground mr-1">Tip:</span>
            {presentTypes.map((typeId) => {
              const active = activeTypes.has(typeId);
              return (
                <Badge
                  key={typeId}
                  variant={active ? 'default' : 'outline'}
                  className={cn(
                    'cursor-pointer text-[10px] px-2 py-0.5 transition-colors select-none',
                    active && (ITEM_TYPE_COLORS[typeId] ?? ''),
                  )}
                  onClick={() => toggleType(typeId)}
                >
                  {ITEM_TYPE_LABELS[typeId] ?? `Tip ${typeId}`}
                </Badge>
              );
            })}
            {activeTypes.size > 0 && (
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground ml-1 underline"
                onClick={() => setActiveTypes(new Set())}
              >
                Temizle
              </button>
            )}
          </div>
        )}
      </div>

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

        {/* Detail panel */}
        <div className="flex flex-1 items-center justify-center rounded-lg border bg-muted/20 text-center text-sm text-muted-foreground">
          {selectedNode ? (
            <div className="flex flex-col gap-3 p-6 text-left w-full max-w-sm">
              <div className="flex items-center gap-2">
                <Badge className={cn('text-[10px]', ITEM_TYPE_COLORS[selectedNode.item_type_id] ?? '')}>
                  {ITEM_TYPE_LABELS[selectedNode.item_type_id] ?? 'Öğe'}
                </Badge>
                <span className="font-semibold">{selectedNode.name}</span>
              </div>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <p><span className="font-medium text-foreground">ID:</span> <span className="font-mono">{selectedNode.id}</span></p>
                <p><span className="font-medium text-foreground">Klasör:</span> <span className="font-mono">{selectedNode.folder_id}</span></p>
              </div>
              {(() => {
                const out = edges.filter((e) => e.source_id === selectedNode.id);
                const inc = edges.filter((e) => e.target_id === selectedNode.id);
                const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n.name]));
                return (
                  <div className="flex flex-col gap-2 text-xs">
                    {out.length > 0 && (
                      <div>
                        <p className="font-medium text-[10px] uppercase tracking-wide text-muted-foreground mb-1">→ Giden ilişkiler</p>
                        {out.map((e) => (
                          <p key={`${e.target_id}-${e.type}`} className="text-muted-foreground">
                            <span className="text-primary font-medium">{REL_LABELS[e.type as RelationshipType]}</span>
                            {' → '}{nodeMap[e.target_id] ?? e.target_id.slice(0, 8)}
                          </p>
                        ))}
                      </div>
                    )}
                    {inc.length > 0 && (
                      <div>
                        <p className="font-medium text-[10px] uppercase tracking-wide text-muted-foreground mb-1">← Gelen ilişkiler</p>
                        {inc.map((e) => (
                          <p key={`${e.source_id}-${e.type}`} className="text-muted-foreground">
                            {nodeMap[e.source_id] ?? e.source_id.slice(0, 8)}
                            {' '}<span className="text-primary font-medium">{REL_LABELS[e.type as RelationshipType]}</span>
                            {' → bu öğe'}
                          </p>
                        ))}
                      </div>
                    )}
                    {out.length === 0 && inc.length === 0 && (
                      <p className="text-muted-foreground">Bu öğenin henüz ilişkisi yok.</p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <p>Detay için sol listeden bir öğe seçin.</p>
          )}
        </div>
      </div>
    </div>
  );
}
