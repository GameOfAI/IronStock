/**
 * Tags Management Page — PR-N7.
 *
 * Users can create personal tags (name + optional hex color) and delete them.
 * Deleting a tag cascade-removes all item_tags associations.
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Tag, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useTagsQuery, useCreateTagMutation, useDeleteTagMutation } from '@/api/tags';

export default function TagsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading } = useTagsQuery();
  const createMut = useCreateTagMutation();
  const deleteMut = useDeleteTagMutation();

  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('');

  const tags = data?.tags ?? [];

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const colorVal = /^#[0-9a-fA-F]{6}$/.test(color) ? color : undefined;
    try {
      await createMut.mutateAsync({ name: trimmedName, color: colorVal });
      setName('');
      setColor('');
      toast({ title: 'Etiket oluşturuldu', description: trimmedName });
    } catch (err) {
      toast({
        title: 'Etiket oluşturulamadı',
        description: err instanceof Error ? err.message : 'Hata.',
        variant: 'destructive',
      });
    }
  }

  async function handleDelete(tagId: string, tagName: string) {
    try {
      await deleteMut.mutateAsync(tagId);
      toast({ title: 'Etiket silindi', description: tagName });
    } catch {
      toast({ title: 'Etiket silinemedi', variant: 'destructive' });
    }
  }

  return (
    <div className="h-full overflow-auto">
    <div className="max-w-xl px-8 py-7 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Etiketlerim</h1>
        <p className="mt-1 text-[13px] text-slate-400">
          Kişisel etiketler — item'lara atayabilirsiniz.
        </p>
      </div>

      {/* Create form */}
      <form onSubmit={handleCreate} className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4">
        <h2 className="text-[13px] font-semibold text-slate-200">Yeni Etiket</h2>
        <div className="flex gap-3">
          <div className="flex-1 space-y-1.5">
            <label htmlFor="tag-name" className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">Ad *</label>
            <input
              id="tag-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="örn. Kritik, Servis, Dev"
              maxLength={64}
              className="w-full rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            />
          </div>
          <div className="w-36 space-y-1.5">
            <label htmlFor="tag-color" className="block font-mono text-[10px] uppercase tracking-wider text-slate-500">Renk (opsiyonel)</label>
            <div className="flex items-center gap-2">
              <input
                id="tag-color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#3b82f6"
                maxLength={7}
                className="flex-1 rounded-md border border-slate-700 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
              <div className="h-8 w-8 shrink-0 rounded-md border border-slate-700" style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#1e293b' }} />
            </div>
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={!name.trim() || createMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-500 disabled:opacity-60">
            <Plus className="h-3.5 w-3.5" />
            {createMut.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
          </button>
        </div>
      </form>

      {/* Tag list */}
      {isLoading ? (
        <p className="text-sm text-slate-500">Yükleniyor…</p>
      ) : tags.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-slate-500">
          <Tag className="h-8 w-8 opacity-40" />
          <p className="text-sm">Henüz etiket yok. Yukarıdan oluşturun.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tags.map((tag) => {
            const col = tag.color ?? '#64748b';
            const r = parseInt(col.slice(1, 3), 16);
            const g = parseInt(col.slice(3, 5), 16);
            const b = parseInt(col.slice(5, 7), 16);
            return (
            <div key={tag.id} className="group flex items-center overflow-hidden rounded-lg border border-slate-800"
              style={{ background: `linear-gradient(90deg, rgba(${r},${g},${b},0.18) 0%, rgba(${r},${g},${b},0.04) 100%)` }}>
              <div className="h-full w-1 shrink-0 self-stretch" style={{ backgroundColor: col }} />
              <div
                className="flex h-10 flex-1 cursor-pointer items-center gap-3 px-4"
                onClick={() => navigate(`/inventory?tag=${tag.id}`)}
                title="Bu etiketle filtrelenmiş envantere git"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: col }} />
                <span className="font-mono text-[13px] font-medium" style={{ color: col }}>{tag.name}</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button className="mr-2 rounded p-1.5 text-slate-600 opacity-0 transition hover:bg-slate-800 hover:text-red-400 group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-slate-800 bg-slate-900">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-slate-100">Etiketi sil</AlertDialogTitle>
                    <AlertDialogDescription className="text-slate-400">
                      <strong className="text-slate-200">{tag.name}</strong> etiketi tüm item'lardan kaldırılacak.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>İptal</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 text-white hover:bg-red-500"
                      onClick={() => handleDelete(tag.id, tag.name)}
                    >
                      Sil
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
