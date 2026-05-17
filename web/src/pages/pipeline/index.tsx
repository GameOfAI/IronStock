/**
 * Pipeline Diagrams list page (PR-F5e).
 *
 * Route: /pipeline
 *
 * Shows all of the current user's named pipeline diagrams.
 * Allows creating, opening, and deleting diagrams.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, GitFork, Trash2, ArrowRight, Loader2, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  usePipelineDiagramsQuery,
  useCreatePipelineDiagramMutation,
  useDeletePipelineDiagramMutation,
} from '@/api/pipeline';
import { cn } from '@/lib/cn';

// --- Create Diagram Modal ────────────────────────────────────────────────────

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
}

function CreateDiagramModal({ open, onClose }: CreateModalProps) {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const navigate = useNavigate();
  const createMut = useCreatePipelineDiagramMutation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const result = await createMut.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setName('');
    setDescription('');
    onClose();
    navigate(`/pipeline/${result.id}`);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl">
        <h2 className="mb-1 text-lg font-semibold">Yeni Pipeline Diyagramı</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          DevOps altyapınızı görsel olarak haritalayın.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Diyagram Adı *</label>
            <Input
              placeholder="ör. Production Pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={256}
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">Açıklama (opsiyonel)</label>
            <Input
              placeholder="Kısa bir açıklama…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              İptal
            </Button>
            <Button type="submit" disabled={!name.trim() || createMut.isPending}>
              {createMut.isPending ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Oluşturuluyor…</>
              ) : (
                'Oluştur'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- Diagram card ────────────────────────────────────────────────────────────

interface DiagramCardProps {
  id: string;
  name: string;
  description?: string | null;
  updatedAt: string;
  nodeCount?: number;
  onDelete: () => void;
}

function DiagramCard({ id, name, description, updatedAt, onDelete }: DiagramCardProps) {
  const navigate = useNavigate();
  const updatedLabel = new Date(updatedAt).toLocaleString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="group relative flex flex-col gap-2 rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Network className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{name}</p>
          {description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{description}</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          Güncellendi: {updatedLabel}
        </span>
        <div className="flex gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Diyagramı sil"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={() => navigate(`/pipeline/${id}`)}
          >
            Aç
            <ArrowRight className="h-3 w-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Page ────────────────────────────────────────────────────────────────────

export default function PipelineListPage() {
  const { data, isLoading, isError } = usePipelineDiagramsQuery();
  const deleteMut = useDeletePipelineDiagramMutation();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: string; name: string } | null>(null);

  const diagrams = data?.diagrams ?? [];

  return (
    <div className="flex h-full flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pipeline Diyagramları</h1>
          <p className="text-sm text-muted-foreground">
            DevOps altyapı mimarinizi görselleştirin
          </p>
        </div>
        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Yeni Diyagram
        </Button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-20 text-destructive text-sm">
          Diyagramlar yüklenirken hata oluştu.
        </div>
      ) : diagrams.length === 0 ? (
        /* Empty state */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <GitFork className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">Henüz diyagram yok</p>
            <p className="text-sm text-muted-foreground">
              İlk pipeline diyagramınızı oluşturun.
            </p>
          </div>
          <Button className="gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Diyagram Oluştur
          </Button>
        </div>
      ) : (
        <div className={cn(
          'grid gap-4',
          'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
        )}>
          {diagrams.map((d) => (
            <DiagramCard
              key={d.id}
              id={d.id}
              name={d.name}
              description={d.description}
              updatedAt={d.updated_at}
              onDelete={() => setDeleteTarget({ id: d.id, name: d.name })}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <CreateDiagramModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {/* Delete confirm dialog */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Diyagramı Sil</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> diyagramını silmek istediğinizden emin
              misiniz? Bu işlem geri alınamaz. Diyagramdaki öğeler ve ilişkiler
              silinmez, yalnızca bu görünüm kaldırılır.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  deleteMut.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                }
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
