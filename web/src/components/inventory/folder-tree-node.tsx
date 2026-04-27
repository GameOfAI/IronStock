/**
 * FolderTreeNode — recursive tree node.
 *
 * Lazy load: child folders sadece expand edilince fetch'lenir
 * (`useChildFolders(id, expanded)`). Loading + error inline gösterilir.
 *
 * Selection: tıklayınca üst component'in `onSelect(folderId)`'unu çağırır.
 * Aynı node tekrar tıklanınca expand/collapse + selection korunur.
 */

import { ChevronRight, FolderClosed, FolderOpen, Loader2 } from 'lucide-react';
import { useChildFolders } from '@/api/folders';
import type { Folder } from '@/api/types';
import { cn } from '@/lib/cn';

interface FolderTreeNodeProps {
  folder: Folder;
  depth: number;
  selectedId: string | null;
  expandedIds: Set<string>;
  onToggle(id: string): void;
  onSelect(id: string): void;
}

export function FolderTreeNode({
  folder,
  depth,
  selectedId,
  expandedIds,
  onToggle,
  onSelect,
}: FolderTreeNodeProps) {
  const isExpanded = expandedIds.has(folder.id);
  const isSelected = selectedId === folder.id;

  const childrenQuery = useChildFolders(folder.id, isExpanded);
  const children = childrenQuery.data?.folders ?? [];
  const hasLoadedAndEmpty = isExpanded && childrenQuery.isSuccess && children.length === 0;

  const FolderIcon = isExpanded ? FolderOpen : FolderClosed;

  return (
    <div role="treeitem" aria-expanded={isExpanded} aria-selected={isSelected}>
      <div
        className={cn(
          'group flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-sm hover:bg-accent',
          isSelected && 'bg-accent font-medium',
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <button
          type="button"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(folder.id);
          }}
          aria-label={isExpanded ? 'Klasörü kapat' : 'Klasörü aç'}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 text-muted-foreground transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
        </button>
        <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{folder.name}</span>
      </div>

      {isExpanded ? (
        <div role="group">
          {childrenQuery.isLoading ? (
            <div
              className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Yükleniyor…
            </div>
          ) : null}
          {childrenQuery.isError ? (
            <div
              className="py-1 text-xs text-red-600"
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
            >
              Alt klasörler okunamadı.
            </div>
          ) : null}
          {hasLoadedAndEmpty ? (
            <div
              className="py-1 text-xs italic text-muted-foreground"
              style={{ paddingLeft: `${(depth + 1) * 12 + 4}px` }}
            >
              Boş
            </div>
          ) : null}
          {children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
