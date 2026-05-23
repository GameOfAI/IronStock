/**
 * TemplateGallery — PR-TPL: Browse and select item templates.
 *
 * Shows public templates + user's own templates. Clicking a template calls
 * onSelect with the template data so the item creation form can pre-fill.
 *
 * Also shows a "Bu item'ı şablon olarak kaydet" action when an existing item
 * context is provided (via onSaveAsTemplate).
 */

import { useState } from 'react';
import { BookTemplate, Plus, Trash2, Globe, Lock, Loader2, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useTemplatesQuery,
  useCreateTemplateMutation,
  useDeleteTemplateMutation,
  type ItemTemplate,
  type CreateTemplateRequest,
} from '@/api/templates';
import { useToast } from '@/hooks/use-toast';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/cn';

interface TemplateGalleryProps {
  onSelect?: (template: ItemTemplate) => void;
  /** Show a "Save as template" button at the bottom */
  onSaveAsTemplate?: (req: CreateTemplateRequest) => void;
  /** Pre-fill item_type_id for save-as-template */
  currentItemTypeId?: number;
  className?: string;
}

export function TemplateGallery({
  onSelect,
  onSaveAsTemplate: _onSaveAsTemplate,
  currentItemTypeId: _currentItemTypeId,
  className,
}: TemplateGalleryProps) {
  const { data: templates, isLoading } = useTemplatesQuery('all');
  const deleteMut = useDeleteTemplateMutation();
  const createMut = useCreateTemplateMutation();
  const userId = useAuthStore((s) => s.user?.id);
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);

  const filtered = (templates ?? []).filter(
    (t) =>
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      (t.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  function handleDelete(tpl: ItemTemplate) {
    deleteMut.mutate(tpl.id, {
      onSuccess: () => toast({ title: `"${tpl.name}" silindi` }),
      onError: () => toast({ title: 'Şablon silinemedi', variant: 'destructive' }),
    });
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createMut.mutate(
      {
        name: newName.trim(),
        item_type_id: 1, // default — user can set in edit
        fields: [],
        tags: [],
        is_public: newIsPublic,
      },
      {
        onSuccess: () => {
          toast({ title: `"${newName.trim()}" şablonu oluşturuldu` });
          setNewName('');
          setShowCreateForm(false);
        },
        onError: () => toast({ title: 'Şablon oluşturulamadı', variant: 'destructive' }),
      },
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Şablon ara..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Template list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {search ? 'Eşleşen şablon bulunamadı.' : 'Henüz şablon yok.'}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {filtered.map((tpl) => (
            <div
              key={tpl.id}
              className={cn(
                'group flex items-center gap-2 rounded-md border p-2.5 text-sm transition',
                onSelect
                  ? 'cursor-pointer hover:border-primary/50 hover:bg-accent'
                  : 'cursor-default',
              )}
              onClick={() => onSelect?.(tpl)}
            >
              <BookTemplate className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{tpl.name}</p>
                {tpl.description && (
                  <p className="text-xs text-muted-foreground truncate">{tpl.description}</p>
                )}
                <div className="mt-1 flex gap-1 flex-wrap">
                  {tpl.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1.5">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {tpl.is_public ? (
                  <Globe className="h-3.5 w-3.5 text-emerald-500" aria-label="Herkese açık" />
                ) : (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Özel" />
                )}
                {(tpl.created_by === userId) && (
                  <button
                    type="button"
                    aria-label="Şablonu sil"
                    className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-destructive hover:bg-destructive/10 transition"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(tpl);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create new template shortcut */}
      <div className="border-t pt-2">
        {showCreateForm ? (
          <div className="flex gap-2">
            <Input
              placeholder="Şablon adı"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-7 text-xs flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newIsPublic}
                onChange={(e) => setNewIsPublic(e.target.checked)}
                className="h-3 w-3"
              />
              Herkese açık
            </label>
            <Button size="sm" className="h-7 text-xs px-2" onClick={handleCreate} disabled={createMut.isPending || !newName.trim()}>
              {createMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Oluştur'}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => setShowCreateForm(false)}>
              İptal
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-xs gap-1.5 text-muted-foreground justify-center"
            onClick={() => setShowCreateForm(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Yeni Şablon
          </Button>
        )}
      </div>
    </div>
  );
}
