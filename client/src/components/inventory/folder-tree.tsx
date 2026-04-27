import { useState } from 'react';
import { AlertCircle, FolderX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRootFolders } from '@/api/folders';
import { FolderTreeNode } from './folder-tree-node';

interface FolderTreeProps {
  selectedId: string | null;
  onSelect(id: string): void;
}

export function FolderTree({ selectedId, onSelect }: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootQuery = useRootFolders();
  const roots = rootQuery.data?.folders ?? [];

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (rootQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Klasörler yükleniyor…
      </div>
    );
  }

  if (rootQuery.isError) {
    return (
      <div className="space-y-2 p-3 text-sm">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-4 w-4" aria-hidden />
          Klasörler okunamadı
        </div>
        <Button variant="outline" size="sm" onClick={() => rootQuery.refetch()}>
          Tekrar dene
        </Button>
      </div>
    );
  }

  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <FolderX className="h-8 w-8" aria-hidden />
        <span>Görüntüleyebileceğiniz klasör yok.</span>
      </div>
    );
  }

  return (
    <div role="tree" aria-label="Klasör ağacı" className="py-1">
      {roots.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          selectedId={selectedId}
          expandedIds={expanded}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
