/**
 * Pipeline Diagram canvas page (PR-F5e).
 *
 * Route: /pipeline/:id
 *
 * Fetches the diagram metadata + graph data, then renders:
 *   ┌──────────────────────────────────────────────┐
 *   │  Breadcrumb header (name + back link)         │
 *   ├──────────┬───────────────────────────────────┤
 *   │ Sidebar  │  ReactFlow Canvas                 │
 *   │ (picker) │  [Toolbar Panel inside]            │
 *   └──────────┴───────────────────────────────────┘
 */

import * as React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Loader2, Network, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  usePipelineDiagramQuery,
  useDiagramGraphQuery,
  useDeletePipelineDiagramMutation,
} from '@/api/pipeline';
import { useLifecycleStagesQuery } from '@/api/lifecycle';
import { PipelineCanvas } from '@/components/pipeline/pipeline-canvas';
import { DiagramSidebar } from '@/components/pipeline/diagram-sidebar';
import { useDocumentTitle } from '@/hooks/use-document-title';

export default function DiagramPage() {
  useDocumentTitle('Pipeline Diyagramı');
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const {
    data: diagramDetail,
    isLoading: detailLoading,
    isError: detailError,
  } = usePipelineDiagramQuery(id ?? null);

  const {
    data: graphData,
    isLoading: graphLoading,
    isError: graphError,
  } = useDiagramGraphQuery(id ?? null);

  const { data: lifecycleData } = useLifecycleStagesQuery();
  const lifecycleCatalog = lifecycleData?.stages ?? [];

  const deleteMut = useDeletePipelineDiagramMutation();

  const existingItemIds = React.useMemo(
    () => new Set((diagramDetail?.nodes ?? []).map((n) => n.item_id)),
    [diagramDetail?.nodes],
  );

  const isLoading = detailLoading || graphLoading;
  const isError = detailError || graphError;

  if (!id) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Geçersiz diyagram ID.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Diyagram yükleniyor…
      </div>
    );
  }

  if (isError || !diagramDetail || !graphData) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">Diyagram yüklenirken hata oluştu.</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/pipeline')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Listeye Dön
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-slate-950">
      {/* Breadcrumb header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            asChild
          >
            <Link to="/pipeline" aria-label="Diyagram listesine dön">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>

          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{diagramDetail.name}</span>
            {diagramDetail.description && (
              <span className="hidden text-sm text-muted-foreground sm:inline">
                — {diagramDetail.description}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {graphData.nodes.length} öğe · {graphData.edges.length} ilişki
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            aria-label="Diyagramı sil"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main: sidebar + canvas */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — item picker */}
        <DiagramSidebar
          diagramId={id}
          existingItemIds={existingItemIds}
        />

        {/* ReactFlow canvas */}
        <div className="flex-1 overflow-hidden">
          <PipelineCanvas
            diagramId={id}
            graphData={graphData}
            lifecycleCatalog={lifecycleCatalog}
            diagramName={diagramDetail?.name}
          />
        </div>
      </div>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Diyagramı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{diagramDetail.name}</strong> diyagramını silmek istediğinizden
              emin misiniz? Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteMut.mutate(id, {
                  onSuccess: () => navigate('/pipeline'),
                });
              }}
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
